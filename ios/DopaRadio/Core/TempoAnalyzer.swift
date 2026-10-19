import AVFoundation
import Foundation

/// BPM解析（AVAssetReaderで先頭40秒をデコードし、低域オンセットの自己相関で推定）
/// DJミックスのテンポ同期に使う。Web版と同じアルゴリズムのネイティブ移植。
enum TempoAnalyzer {
    private static var cache: [String: Double] = [:]
    private static var inFlight: Set<String> = []
    private static let lock = NSLock()

    static func cachedBPM(trackId: String) -> Double? {
        lock.lock()
        defer { lock.unlock() }
        return cache[trackId]
    }

    /// バックグラウンドでBPM解析を開始（結果はキャッシュ）
    static func analyze(trackId: String, url: URL) {
        lock.lock()
        if cache[trackId] != nil || inFlight.contains(trackId) {
            lock.unlock()
            return
        }
        inFlight.insert(trackId)
        lock.unlock()

        Task.detached(priority: .utility) {
            let bpm = await computeBPM(url: url)
            lock.lock()
            inFlight.remove(trackId)
            if let bpm {
                cache[trackId] = bpm
            }
            lock.unlock()
        }
    }

    private static func computeBPM(url: URL) async -> Double? {
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first else {
            return nil
        }
        guard let reader = try? AVAssetReader(asset: asset) else { return nil }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsNonInterleaved: false,
            AVNumberOfChannelsKey: 1,
            AVSampleRateKey: 22050,
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { return nil }
        reader.add(output)
        reader.timeRange = CMTimeRange(
            start: .zero,
            duration: CMTime(seconds: 40, preferredTimescale: 600)
        )
        guard reader.startReading() else { return nil }

        let sampleRate = 22050
        let maxSamples = sampleRate * 42
        var samples = [Float]()
        samples.reserveCapacity(sampleRate * 40)

        while let sampleBuffer = output.copyNextSampleBuffer() {
            defer { CMSampleBufferInvalidate(sampleBuffer) }
            guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
            let length = CMBlockBufferGetDataLength(blockBuffer)
            guard length >= 4 else { continue }
            var chunk = [Float](repeating: 0, count: length / 4)
            chunk.withUnsafeMutableBytes { raw in
                guard let base = raw.baseAddress else { return }
                _ = CMBlockBufferCopyDataBytes(
                    blockBuffer, atOffset: 0, dataLength: length, destination: base
                )
            }
            samples.append(contentsOf: chunk)
            if samples.count >= maxSamples { break }
        }
        reader.cancelReading()

        guard samples.count > sampleRate * 20 else { return nil }
        return estimateBPM(samples: samples, sampleRate: Double(sampleRate))
    }

    static func estimateBPM(samples: [Float], sampleRate: Double) -> Double? {
        let hop = 1024
        let frameCount = samples.count / hop
        guard frameCount > 100 else { return nil }

        // 約200HzのワンポールLPFで低域だけ取り出し、フレームごとのエネルギー→オンセット
        var onset = [Float](repeating: 0, count: frameCount)
        var lp: Float = 0
        let alpha: Float = 0.06
        var previousEnergy: Float = 0
        for frame in 0..<frameCount {
            var energy: Float = 0
            let base = frame * hop
            for index in 0..<hop {
                lp += alpha * (samples[base + index] - lp)
                energy += lp * lp
            }
            onset[frame] = max(0, energy - previousEnergy)
            previousEnergy = energy
        }

        let hopSec = Double(hop) / sampleRate
        let minLag = max(1, Int(60.0 / 180.0 / hopSec))
        let maxLag = min(frameCount / 2, Int(60.0 / 60.0 / hopSec))
        guard maxLag > minLag else { return nil }

        func scoreAt(_ lag: Int) -> Float {
            guard lag >= 1, lag < frameCount else { return 0 }
            var score: Float = 0
            for frame in lag..<frameCount {
                score += onset[frame] * onset[frame - lag]
            }
            return score / Float(frameCount - lag)
        }

        var bestLag = 0
        var bestScore: Float = 0
        for lag in minLag...maxLag {
            var score = scoreAt(lag)
            let bpm = 60.0 / (Double(lag) * hopSec)
            let weight: Float = (bpm >= 80 && bpm <= 160) ? 1.05 : 0.95
            score *= weight
            if score > bestScore {
                bestScore = score
                bestLag = lag
            }
        }
        guard bestLag > 0 else { return nil }

        // 放物線補間でサブフレーム精度
        var refinedLag = Double(bestLag)
        if bestLag > minLag && bestLag < maxLag {
            let scorePrev = scoreAt(bestLag - 1)
            let scoreNext = scoreAt(bestLag + 1)
            let denominator = scorePrev - 2 * bestScore + scoreNext
            if denominator != 0 {
                let delta = 0.5 * (scorePrev - scoreNext) / denominator
                refinedLag = Double(bestLag) + Double(max(-0.5, min(0.5, delta)))
            }
        }
        let rawBPM = 60.0 / (refinedLag * hopSec)

        // オクターブ補正: 自己相関は2拍周期でも強く出るため、
        // ドパ系で一般的な100〜200BPMに収まるよう補正する
        if rawBPM < 100, rawBPM * 2 <= 200 {
            return rawBPM * 2
        }
        if rawBPM > 200 {
            return rawBPM / 2
        }
        return rawBPM
    }
}
