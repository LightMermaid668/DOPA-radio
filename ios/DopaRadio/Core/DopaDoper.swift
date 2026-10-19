#if os(macOS)
import AVFoundation
import Accelerate
import Foundation

/// Mac限定: 「ドパドパ加工」
///
/// 元の曲（AI生成 or 手持ち音源）を解析し、目標BPMへテンポ変換（キー維持）したうえで
/// 4つ打ちキック・オフビートベース・サイドチェインポンプを重ねて高揚感を強化する。
enum DopaDoper {
    struct Options {
        var targetBPM: Double = 170
        var drumLevel: Float = 0.9
        var bassLevel: Float = 0.85
        var pumpDepth: Float = 0.55
        var addBass: Bool = true
        var addPump: Bool = true
        /// 指定時は自動検出を使わずこのBPMを元テンポとして扱う
        var manualBPM: Double?
    }

    struct Result {
        let fileURL: URL
        let originalBPM: Double
        let targetBPM: Double
        let keyName: String?
        let durationSec: Double
    }

    enum DoperError: LocalizedError {
        case loadFailed(String)
        case bpmFailed
        case renderFailed
        case writeFailed

        var errorDescription: String? {
            switch self {
            case .loadFailed(let reason): return "音源を読み込めません: \(reason)"
            case .bpmFailed: return "BPMを検出できませんでした（ビートが弱い音源かもしれません）"
            case .renderFailed: return "テンポ変換に失敗しました"
            case .writeFailed: return "書き出しに失敗しました"
            }
        }
    }

    private static let sampleRate = 44_100.0

    static var outputDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DOPA-AI", isDirectory: true)
    }

    // MARK: - メイン処理

    static func process(
        sourceURL: URL,
        options: Options,
        progress: (@Sendable (String) -> Void)? = nil
    ) throws -> Result {
        progress?("音源を読み込み中…")
        var (left, right) = try load(url: sourceURL)

        progress?("BPMを解析中…")
        let detected = try loadAndDetectBPM(url: sourceURL)
        guard let originalBPM = options.manualBPM ?? detected else {
            throw DoperError.bpmFailed
        }
        let targetBPM = min(200, max(120, options.targetBPM))

        var factor = 1.0
        if abs(targetBPM - originalBPM) / originalBPM > 0.01 {
            factor = targetBPM / originalBPM
            progress?("テンポを変換中…（\(Int(originalBPM.rounded())) → \(Int(targetBPM)) BPM・キー維持）")
            (left, right) = try stretch(left: left, right: right, rate: factor)
        }

        progress?("キーを解析中…")
        let key = detectKey(left: left, right: right)

        progress?("ビート位置を検出中…")
        let offset = beatOffset(left: left, right: right, bpm: targetBPM)

        progress?("ドパドパ層を合成中…")
        let (layerL, layerR) = renderLayers(
            totalFrames: left.count,
            bpm: targetBPM,
            startOffset: offset,
            keyRoot: key?.root,
            options: options
        )

        if options.addPump {
            applyPump(&left, &right, bpm: targetBPM, startOffset: offset, depth: options.pumpDepth)
        }

        for index in 0..<left.count {
            left[index] += layerL[index]
            right[index] += layerR[index]
        }
        normalize(&left, &right, target: 0.92)

        progress?("書き出し中…")
        let base = sourceURL.deletingPathExtension().lastPathComponent
        let outputURL = outputDirectory.appendingPathComponent(
            "\(sanitize(base)) ドパドパ.m4a"
        )
        try write(left: left, right: right, to: outputURL)

        return Result(
            fileURL: outputURL,
            originalBPM: originalBPM,
            targetBPM: targetBPM,
            keyName: key.map { "\(noteName($0.root))\($0.minor ? "m" : "")" },
            durationSec: Double(left.count) / sampleRate
        )
    }

    // MARK: - 読み込み

    private static func load(url: URL) throws -> (left: [Float], right: [Float]) {
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url)
        } catch {
            throw DoperError.loadFailed("ファイルを開けません")
        }
        let format = file.processingFormat
        guard file.length > 0, file.length < Int64(sampleRate * 60 * 12) else {
            throw DoperError.loadFailed("長さが対応範囲外です（最大12分）")
        }
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)
        ) else {
            throw DoperError.loadFailed("バッファを確保できません")
        }
        do {
            try file.read(into: buffer)
        } catch {
            throw DoperError.loadFailed("デコードに失敗しました")
        }
        guard let channels = buffer.floatChannelData else {
            throw DoperError.loadFailed("未対応のフォーマットです")
        }
        let count = Int(buffer.frameLength)
        var left = Array(UnsafeBufferPointer(start: channels[0], count: count))
        var right = format.channelCount > 1
            ? Array(UnsafeBufferPointer(start: channels[1], count: count))
            : left
        if abs(format.sampleRate - sampleRate) > 1 {
            left = resample(left, from: format.sampleRate)
            right = resample(right, from: format.sampleRate)
        }
        return (left, right)
    }

    private static func resample(_ samples: [Float], from sourceRate: Double) -> [Float] {
        let ratio = sampleRate / sourceRate
        let outCount = Int(Double(samples.count) * ratio)
        guard outCount > 0 else { return [] }
        var output = [Float](repeating: 0, count: outCount)
        for index in 0..<outCount {
            let position = Double(index) / ratio
            let base = Int(position)
            let fraction = Float(position - Double(base))
            let a = samples[min(base, samples.count - 1)]
            let b = samples[min(base + 1, samples.count - 1)]
            output[index] = a + (b - a) * fraction
        }
        return output
    }

    // MARK: - 解析

    /// 加工前のBPMだけを調べる（UIの検出BPM表示用）
    static func loadAndDetectBPM(url: URL) throws -> Double? {
        let (left, right) = try load(url: url)
        return detectBPM(left: left, right: right)
    }

    private static func detectBPM(left: [Float], right: [Float]) -> Double? {
        let limit = min(left.count, Int(sampleRate * 60))
        guard limit > Int(sampleRate * 10) else { return nil }
        var mono = [Float](repeating: 0, count: limit)
        for index in 0..<limit {
            mono[index] = (left[index] + right[index]) * 0.5
        }
        return TempoAnalyzer.estimateBPM(samples: mono, sampleRate: sampleRate)
    }

    private static func detectKey(left: [Float], right: [Float]) -> (root: Int, minor: Bool)? {
        let fftSize = 4096
        let log2n = vDSP_Length(log2(Double(fftSize)))
        guard let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return nil }
        defer { vDSP_destroy_fftsetup(setup) }

        var window = [Float](repeating: 0, count: fftSize)
        vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))

        let limit = min(left.count, Int(sampleRate * 90))
        guard limit > fftSize * 4 else { return nil }

        var chroma = [Double](repeating: 0, count: 12)
        var real = [Float](repeating: 0, count: fftSize / 2)
        var imag = [Float](repeating: 0, count: fftSize / 2)
        var frame = [Float](repeating: 0, count: fftSize)
        var magnitudes = [Float](repeating: 0, count: fftSize / 2)

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
                        vDSP_ctoz(base.assumingMemoryBound(to: DSPComplex.self), 2, &split, 1, vDSP_Length(fftSize / 2))
                    }
                    vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                    vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(fftSize / 2))
                }
            }
            for bin in 1..<(fftSize / 2) {
                let frequency = Double(bin) * sampleRate / Double(fftSize)
                guard frequency >= 55, frequency <= 1200 else { continue }
                let midi = 69.0 + 12.0 * log2(frequency / 440.0)
                let pitchClass = ((Int(midi.rounded()) % 12) + 12) % 12
                chroma[pitchClass] += Double(magnitudes[bin])
            }
            start += fftSize / 2
        }

        let total = chroma.reduce(0, +)
        guard total > 0 else { return nil }
        chroma = chroma.map { $0 / total }

        // Krumhansl の調性プロファイル
        let major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        let minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

        var best = -Double.infinity
        var bestRoot = 9
        var bestMinor = false
        for root in 0..<12 {
            var majorScore = 0.0
            var minorScore = 0.0
            for degree in 0..<12 {
                let value = chroma[(root + degree) % 12]
                majorScore += value * major[degree]
                minorScore += value * minor[degree]
            }
            if majorScore > best {
                best = majorScore
                bestRoot = root
                bestMinor = false
            }
            if minorScore > best {
                best = minorScore
                bestRoot = root
                bestMinor = true
            }
        }
        return (bestRoot, bestMinor)
    }

    /// ビートの位相（最初のキック位置の秒）
    private static func beatOffset(left: [Float], right: [Float], bpm: Double) -> Double {
        let hop = 256
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
        var onset = [Float](repeating: 0, count: frameCount)
        for frame in 1..<frameCount {
            onset[frame] = max(0, energy[frame] - energy[frame - 1])
        }

        let hopSeconds = Double(hop) / sampleRate
        let lag = Int((60.0 / bpm / hopSeconds).rounded())
        guard lag >= 2 else { return 0 }

        var bestPhase = 0
        var bestScore: Float = -1
        for phase in 0..<lag {
            var score: Float = 0
            var index = phase
            while index < frameCount {
                score += onset[index]
                index += lag
            }
            if score > bestScore {
                bestScore = score
                bestPhase = phase
            }
        }
        return Double(bestPhase) * hopSeconds
    }

    // MARK: - テンポ変換（キー維持）

    private static func stretch(
        left: [Float], right: [Float], rate: Double
    ) throws -> (left: [Float], right: [Float]) {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let pitch = AVAudioUnitTimePitch()
        let effectiveRate = Float(min(2.0, max(0.5, rate)))
        pitch.rate = effectiveRate

        guard let format = AVAudioFormat(
            standardFormatWithSampleRate: sampleRate, channels: 2
        ) else { throw DoperError.renderFailed }

        engine.attach(player)
        engine.attach(pitch)
        engine.connect(player, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)

        let maximumFrames: AVAudioFrameCount = 4096
        do {
            try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: maximumFrames)
        } catch {
            throw DoperError.renderFailed
        }

        guard let input = AVAudioPCMBuffer(
            pcmFormat: format, frameCapacity: AVAudioFrameCount(left.count)
        ) else { throw DoperError.renderFailed }
        input.frameLength = AVAudioFrameCount(left.count)
        if let channels = input.floatChannelData {
            for index in 0..<left.count {
                channels[0][index] = left[index]
                channels[1][index] = right[index]
            }
        }

        do {
            try engine.start()
        } catch {
            throw DoperError.renderFailed
        }
        player.scheduleBuffer(input, at: nil, options: [], completionHandler: nil)
        player.play()

        guard let output = AVAudioPCMBuffer(
            pcmFormat: engine.manualRenderingFormat, frameCapacity: maximumFrames
        ) else { throw DoperError.renderFailed }

        let expectedFrames = Int(Double(left.count) / Double(effectiveRate))
        var outputLeft: [Float] = []
        var outputRight: [Float] = []
        outputLeft.reserveCapacity(expectedFrames + 44_100)
        outputRight.reserveCapacity(expectedFrames + 44_100)

        var emptyStreak = 0
        var iterations = 0
        while emptyStreak < 6 && iterations < 100_000 {
            iterations += 1
            let status: AVAudioEngineManualRenderingStatus
            do {
                status = try engine.renderOffline(maximumFrames, to: output)
            } catch {
                throw DoperError.renderFailed
            }
            switch status {
            case .success:
                emptyStreak = 0
                if let channels = output.floatChannelData {
                    let count = Int(output.frameLength)
                    outputLeft.append(contentsOf: UnsafeBufferPointer(start: channels[0], count: count))
                    outputRight.append(contentsOf: UnsafeBufferPointer(start: channels[1], count: count))
                }
                if outputLeft.count > expectedFrames + 44_100 {
                    emptyStreak = 6
                }
            case .insufficientDataFromInputNode:
                emptyStreak += 1
            case .cannotDoInCurrentContext:
                continue
            case .error:
                throw DoperError.renderFailed
            @unknown default:
                throw DoperError.renderFailed
            }
        }
        player.stop()
        engine.stop()
        engine.disableManualRenderingMode()

        guard outputLeft.count > Int(sampleRate * 5) else { throw DoperError.renderFailed }
        if outputLeft.count > expectedFrames + 44_100 {
            outputLeft.removeLast(outputLeft.count - expectedFrames)
            outputRight.removeLast(outputRight.count - expectedFrames)
        }
        return (outputLeft, outputRight)
    }

    // MARK: - ドパドパ層の合成

    private static func renderLayers(
        totalFrames: Int,
        bpm: Double,
        startOffset: Double,
        keyRoot: Int?,
        options: Options
    ) -> (left: [Float], right: [Float]) {
        var layerLeft = [Float](repeating: 0, count: totalFrames)
        var layerRight = [Float](repeating: 0, count: totalFrames)

        let beat = 60.0 / bpm
        let step = beat / 4
        let totalSeconds = Double(totalFrames) / sampleRate
        let bassRootMidi = 36 + (keyRoot ?? 9)

        var stepIndex = 0
        var time = startOffset
        while time < totalSeconds + beat {
            let inBar = stepIndex % 16
            switch inBar {
            case 0, 4, 8, 12:
                addKick(&layerLeft, &layerRight, at: time, gain: 0.95 * options.drumLevel)
            case 4, 12:
                addClap(&layerLeft, &layerRight, at: time, gain: 0.5 * options.drumLevel)
            case 2, 6, 10, 14:
                addHat(&layerLeft, &layerRight, at: time, gain: 0.3 * options.drumLevel, open: true)
            case 7, 15:
                addHat(&layerLeft, &layerRight, at: time, gain: 0.12 * options.drumLevel, open: false)
            default:
                break
            }
            if options.addBass, keyRoot != nil {
                switch inBar {
                case 2, 6, 10, 14:
                    addBass(
                        &layerLeft, &layerRight, at: time, duration: step * 1.7,
                        midi: bassRootMidi, gain: 0.8 * options.bassLevel
                    )
                case 15:
                    addBass(
                        &layerLeft, &layerRight, at: time, duration: step * 0.8,
                        midi: bassRootMidi, gain: 0.5 * options.bassLevel
                    )
                default:
                    break
                }
            }
            time += step
            stepIndex += 1
        }
        return (layerLeft, layerRight)
    }

    private static func applyPump(
        _ left: inout [Float], _ right: inout [Float],
        bpm: Double, startOffset: Double, depth: Float
    ) {
        let beat = 60.0 / bpm
        let duckSeconds = min(0.32, beat * 0.85)
        let totalSeconds = Double(left.count) / sampleRate
        var time = startOffset
        while time < totalSeconds {
            let startIndex = Int(time * sampleRate)
            let count = min(Int(duckSeconds * sampleRate), left.count - startIndex)
            if count > 0 {
                for index in 0..<count {
                    let t = Double(index) / sampleRate
                    let envelope = 1 - depth * Float(exp(-t / 0.1))
                    left[startIndex + index] *= envelope
                    right[startIndex + index] *= envelope
                }
            }
            time += beat
        }
    }

    // MARK: 波形（キック/クラップ/ハット/ベース）

    private static func write(
        _ left: inout [Float], _ right: inout [Float], at time: Double, _ l: Float, _ r: Float
    ) {
        let index = Int(time * sampleRate)
        guard index >= 0, index < left.count else { return }
        left[index] += l
        right[index] += r
    }

    private static func addKick(
        _ left: inout [Float], _ right: inout [Float], at time: Double, gain: Float
    ) {
        let duration = 0.42
        let count = Int(duration * sampleRate)
        var phase = 0.0
        for index in 0..<count {
            let t = Double(index) / sampleRate
            let frequency = 42 + 92 * exp(-t / 0.035)
            phase += 2 * .pi * frequency / sampleRate
            let envelope = exp(-t / 0.19)
            var value = sin(phase) * envelope
            if index < 160 {
                value += Double.random(in: -0.6...0.6) * (1 - Double(index) / 160) * 0.45
            }
            let out = Float(tanh(value * 1.35) * Double(gain))
            write(&left, &right, at: time + t, out, out)
        }
    }

    private static func addClap(
        _ left: inout [Float], _ right: inout [Float], at time: Double, gain: Float
    ) {
        let count = Int(0.24 * sampleRate)
        var previous = 0.0
        for index in 0..<count {
            let t = Double(index) / sampleRate
            let burst =
                exp(-t / 0.016)
                + 0.65 * exp(-max(0, t - 0.010) / 0.016)
                + 0.55 * exp(-max(0, t - 0.021) / 0.028)
            let white = Double.random(in: -1...1)
            let high = white - previous
            previous = white
            let out = Float(high * burst * Double(gain) * 0.5)
            write(&left, &right, at: time + t, out, out)
        }
    }

    private static func addHat(
        _ left: inout [Float], _ right: inout [Float], at time: Double, gain: Float, open: Bool
    ) {
        let duration = open ? 0.22 : 0.04
        let count = Int(duration * sampleRate)
        var previous = 0.0
        for index in 0..<count {
            let t = Double(index) / sampleRate
            let envelope = exp(-t / (open ? 0.09 : 0.013))
            let white = Double.random(in: -1...1)
            let high = white - previous
            previous = white
            let out = Float(high * envelope * Double(gain) * 0.35)
            write(&left, &right, at: time + t, out * 0.85, out)
        }
    }

    private static func addBass(
        _ left: inout [Float], _ right: inout [Float],
        at time: Double, duration: Double, midi: Int, gain: Float
    ) {
        let count = Int(duration * sampleRate)
        guard count > 0 else { return }
        let frequency = 440 * pow(2, Double(midi - 69) / 12)
        let increment = frequency / sampleRate
        let subIncrement = increment / 2
        var phase = 0.0
        var subPhase = 0.0
        var lowpass = 0.0
        for index in 0..<count {
            let t = Double(index) / sampleRate
            let envelope = min(1, t / 0.006) * exp(-t / (duration * 0.8))
            phase += increment
            if phase > 1 { phase -= 1 }
            subPhase += subIncrement
            if subPhase > 1 { subPhase -= 1 }
            let saw = 2 * phase - 1
            let square = phase < 0.5 ? 1.0 : -1.0
            let raw = saw * 0.65 + square * 0.35
            let coefficient = 0.02 + 0.14 * exp(-t / 0.06)
            lowpass += coefficient * (raw - lowpass)
            let driven = tanh(lowpass * 1.8)
            let value = (driven * 0.6 + sin(2 * .pi * subPhase) * 0.85) * envelope * Double(gain)
            write(&left, &right, at: time + t, Float(value), Float(value))
        }
    }

    // MARK: - 仕上げ

    private static func normalize(_ left: inout [Float], _ right: inout [Float], target: Float) {
        var peak: Float = 0.0001
        for index in 0..<left.count {
            peak = max(peak, abs(left[index]), abs(right[index]))
        }
        let gain = min(6, target / peak)
        for index in 0..<left.count {
            left[index] = tanh(left[index] * gain)
            right[index] = tanh(right[index] * gain)
        }
    }

    private static func write(left: [Float], right: [Float], to url: URL) throws {
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? FileManager.default.removeItem(at: url)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 192_000,
        ]
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forWriting: url, settings: settings)
        } catch {
            throw DoperError.writeFailed
        }
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192)
        else { throw DoperError.writeFailed }

        var offset = 0
        while offset < left.count {
            let count = min(8192, left.count - offset)
            buffer.frameLength = AVAudioFrameCount(count)
            guard let channels = buffer.floatChannelData else { break }
            for index in 0..<count {
                channels[0][index] = left[offset + index]
                channels[1][index] = right[offset + index]
            }
            do {
                try file.write(from: buffer)
            } catch {
                throw DoperError.writeFailed
            }
            offset += count
        }
    }

    private static func noteName(_ pitchClass: Int) -> String {
        let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        return names[((pitchClass % 12) + 12) % 12]
    }

    private static func sanitize(_ name: String) -> String {
        name
            .replacingOccurrences(of: "/", with: "／")
            .replacingOccurrences(of: ":", with: "：")
    }
}
#endif
