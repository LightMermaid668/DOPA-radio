#if os(macOS)
import AVFoundation
import Accelerate
import Foundation

/// Mac限定: 参考曲の「ノリノリ度」を数値化する
enum ReferenceAnalyzer {
    struct Report: Identifiable {
        let id = UUID()
        let fileName: String
        let bpm: Double?
        let keyName: String?
        /// オフビート（裏拍）の打点比率 0..1
        let offbeatRatio: Double
        /// 超低域（<80Hz）のエネルギー比
        let subBassRatio: Double
        /// 低域（80-250Hz）のエネルギー比
        let lowBassRatio: Double
        /// スペクトル重心（Hz）
        let centroidHz: Double
        /// 打点数/秒
        let onsetsPerSecond: Double
        /// 総合スコア 0..100
        let score: Int
    }

    static func analyze(url: URL) throws -> Report {
        let (left, right) = try DopaDoper.load(url: url)
        guard left.count > 44_100 * 5 else {
            throw AnalyzerError.tooShort
        }
        let mono = mix(left: left, right: right)
        let bpm = TempoAnalyzer.estimateBPM(samples: mono, sampleRate: 44_100)
        let key = DopaDoper.detectKey(left: left, right: right)
        let offbeat = bpm.map { offbeatRatio(left: left, right: right, bpm: $0) } ?? 0
        let bands = bandEnergies(left: left, right: right)
        let onsets = onsetDensity(left: left, right: right)

        let subBass = bands.sub
        let lowBass = bands.low
        let score = Int(
            min(
                100,
                max(
                    0,
                    offbeat * 40
                        + min(onsets / 18, 1) * 30
                        + min(subBass / 0.12, 1) * 30
                )
            )
        )

        return Report(
            fileName: url.lastPathComponent,
            bpm: bpm,
            keyName: key.map { "\(DopaDoper.noteName($0.root))\($0.minor ? "m" : "")" },
            offbeatRatio: offbeat,
            subBassRatio: subBass,
            lowBassRatio: lowBass,
            centroidHz: bands.centroid,
            onsetsPerSecond: onsets,
            score: score
        )
    }

    // MARK: - 指標

    private static func mix(left: [Float], right: [Float]) -> [Float] {
        let count = min(left.count, right.count)
        var mono = [Float](repeating: 0, count: count)
        for index in 0..<count {
            mono[index] = (left[index] + right[index]) * 0.5
        }
        return mono
    }

    /// 裏拍（オフビート8分）に打点がどれだけ乗っているか
    private static func offbeatRatio(left: [Float], right: [Float], bpm: Double) -> Double {
        let hop = 512
        let frameCount = min(left.count, right.count) / hop
        guard frameCount > 16 else { return 0 }

        var energy = [Float](repeating: 0, count: frameCount)
        for frame in 0..<frameCount {
            var sum: Float = 0
            let base = frame * hop
            for index in 0..<hop {
                sum += abs(left[base + index]) + abs(right[base + index])
            }
            energy[frame] = sum
        }
        var onset = [Float](repeating: 0, count: frameCount)
        for frame in 1..<frameCount {
            onset[frame] = max(0, energy[frame] - energy[frame - 1])
        }

        let hopSeconds = Double(hop) / 44_100
        let beatFrames = max(2, Int((60.0 / bpm / hopSeconds).rounded()))
        let offsetFrames = DopaDoper.beatOffset(left: left, right: right, bpm: bpm)
        let phase = Int(offsetFrames / hopSeconds)
        let half = beatFrames / 2

        var beatSum: Float = 0
        var offSum: Float = 0
        var index = phase
        while index < frameCount {
            beatSum += onset[index]
            let offbeat = index + half
            if offbeat < frameCount {
                offSum += onset[offbeat]
            }
            index += beatFrames
        }
        let total = beatSum + offSum
        return total > 0 ? Double(offSum / total) : 0
    }

    private static func bandEnergies(
        left: [Float], right: [Float]
    ) -> (sub: Double, low: Double, mid: Double, high: Double, centroid: Double) {
        let fftSize = 4096
        let log2n = vDSP_Length(log2(Double(fftSize)))
        guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            return (0, 0, 0, 0, 0)
        }
        defer { vDSP_destroy_fftsetup(setup) }

        var window = [Float](repeating: 0, count: fftSize)
        vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))

        let limit = min(left.count, right.count, Int(44_100 * 90))
        var sub = 0.0
        var low = 0.0
        var mid = 0.0
        var high = 0.0
        var weighted = 0.0
        var magnitudeSum = 0.0

        var real = [Float](repeating: 0, count: fftSize / 2)
        var imag = [Float](repeating: 0, count: fftSize / 2)
        var mags = [Float](repeating: 0, count: fftSize / 2)
        var frame = [Float](repeating: 0, count: fftSize)

        var start = 0
        while start + fftSize <= limit {
            for index in 0..<fftSize {
                frame[index] = (left[start + index] + right[start + index]) * 0.5 * window[index]
            }
            real.withUnsafeMutableBufferPointer { realPointer in
                imag.withUnsafeMutableBufferPointer { imagPointer in
                    var split = DSPSplitComplex(
                        realp: realPointer.baseAddress!, imagp: imagPointer.baseAddress!
                    )
                    frame.withUnsafeBytes { raw in
                        guard let base = raw.baseAddress else { return }
                        vDSP_ctoz(
                            base.assumingMemoryBound(to: DSPComplex.self), 2, &split, 1,
                            vDSP_Length(fftSize / 2)
                        )
                    }
                    vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                    vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(fftSize / 2))
                }
            }
            for bin in 1..<(fftSize / 2) {
                let frequency = Double(bin) * 44_100 / Double(fftSize)
                let magnitude = Double(mags[bin])
                switch frequency {
                case ..<80: sub += magnitude
                case ..<250: low += magnitude
                case ..<2_000: mid += magnitude
                default: high += magnitude
                }
                weighted += frequency * magnitude
                magnitudeSum += magnitude
            }
            start += fftSize
        }
        let total = sub + low + mid + high
        guard total > 0 else { return (0, 0, 0, 0, 0) }
        return (
            sub / total, low / total, mid / total, high / total,
            magnitudeSum > 0 ? weighted / magnitudeSum : 0
        )
    }

    private static func onsetDensity(left: [Float], right: [Float]) -> Double {
        let hop = 512
        let frameCount = min(left.count, right.count) / hop
        guard frameCount > 8 else { return 0 }
        var energy = [Float](repeating: 0, count: frameCount)
        for frame in 0..<frameCount {
            var sum: Float = 0
            let base = frame * hop
            for index in 0..<hop {
                sum += abs(left[base + index]) + abs(right[base + index])
            }
            energy[frame] = sum
        }
        var flux = [Float](repeating: 0, count: frameCount)
        for frame in 1..<frameCount {
            flux[frame] = max(0, energy[frame] - energy[frame - 1])
        }
        let mean = flux.reduce(0, +) / Float(frameCount)
        let threshold = max(mean * 1.6, 0.0001)
        let onsets = flux.filter { $0 > threshold }.count
        let seconds = Double(frameCount) * Double(hop) / 44_100
        return seconds > 0 ? Double(onsets) / seconds : 0
    }

    // MARK: - 提案

    struct Suggestion {
        let prompt: String
        let bpm: Int
    }

    static func suggestion(from reports: [Report]) -> Suggestion? {
        guard !reports.isEmpty else { return nil }
        let bpms = reports.compactMap(\.bpm).sorted()
        let bpm = bpms.isEmpty ? 170 : Int(bpms[bpms.count / 2].rounded())
        let offbeat = reports.map(\.offbeatRatio).reduce(0, +) / Double(reports.count)
        let sub = reports.map(\.subBassRatio).reduce(0, +) / Double(reports.count)
        let onsets = reports.map(\.onsetsPerSecond).reduce(0, +) / Double(reports.count)
        let centroid = reports.map(\.centroidHz).reduce(0, +) / Double(reports.count)

        var tags = ["\(bpm) BPM", "high energy", "Norinoricore remix"]
        if offbeat > 0.45 {
            tags += ["heavy four-on-the-floor kick", "offbeat pumping bass"]
        }
        if sub > 0.08 {
            tags += ["deep sub bass", "hard kick", "punchy low end"]
        }
        if onsets > 12 {
            tags += ["dense arrangement", "constant hooks", "fast tempo"]
        }
        if centroid > 2_400 {
            tags += ["bright supersaw synths", "sparkling leads"]
        }
        tags += ["loud compressed mix", "instrumental"]
        return Suggestion(prompt: tags.joined(separator: ", "), bpm: bpm)
    }

    enum AnalyzerError: LocalizedError {
        case tooShort

        var errorDescription: String? {
            switch self {
            case .tooShort: return "音源が短すぎます（5秒以上必要）"
            }
        }
    }
}
#endif
