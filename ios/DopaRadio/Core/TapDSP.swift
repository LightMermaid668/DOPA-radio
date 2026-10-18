import AVFoundation
import Foundation

/// ネイティブDSP（MTAudioProcessingTap用）
/// EQ（低/中/高）・低音ブースト・ボーカル除去（L/R位相反転）・8D回転・DJ用ハイパス
final class TapDSP {
    // MARK: - 設定（メインスレッドから書き込み、オーディオスレッドから読む）

    var eqEnabled = false
    var bassDB: Float = 0
    var midDB: Float = 0
    var trebleDB: Float = 0
    var bassBoostDB: Float = 0
    /// 0..1（ボーカル除去の強さ）
    var vocalAmount: Float = 0
    var eightD = false
    /// DJミックスのベーススワップ用ハイパス（約200Hz）
    var highpassOn = false

    // MARK: - 内部状態

    struct FilterState {
        var z1: Float = 0
        var z2: Float = 0
        mutating func reset() {
            z1 = 0
            z2 = 0
        }
    }

    struct Biquad {
        var b0: Float = 1
        var b1: Float = 0
        var b2: Float = 0
        var a1: Float = 0
        var a2: Float = 0

        func process(_ x: Float, state: inout FilterState) -> Float {
            let y = b0 * x + state.z1
            state.z1 = b1 * x - a1 * y + state.z2
            state.z2 = b2 * x - a2 * y
            return y
        }
    }

    private var sampleRate: Double = 44100
    private var channels: Int = 2
    private var isInterleaved = false
    private var isPrepared = false

    private var hpCoeffs = Biquad()
    private var lowCoeffs = Biquad()
    private var boostCoeffs = Biquad()
    private var midCoeffs = Biquad()
    private var highCoeffs = Biquad()

    private var hpState = [FilterState](repeating: FilterState(), count: 2)
    private var lowState = [FilterState](repeating: FilterState(), count: 2)
    private var boostState = [FilterState](repeating: FilterState(), count: 2)
    private var midState = [FilterState](repeating: FilterState(), count: 2)
    private var highState = [FilterState](repeating: FilterState(), count: 2)

    private var eightDPhase: Float = 0

    // 係数の再計算用キャッシュ
    private var lastKey: String = ""

    // MARK: - 準備

    func prepare(format: AudioStreamBasicDescription) {
        sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 44100
        channels = max(1, min(2, Int(format.mChannelsPerFrame)))
        isInterleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        resetStates()
        isPrepared = true
        lastKey = ""
    }

    private func resetStates() {
        for index in 0..<2 {
            hpState[index].reset()
            lowState[index].reset()
            boostState[index].reset()
            midState[index].reset()
            highState[index].reset()
        }
        eightDPhase = 0
    }

    // MARK: - 係数

    private func recomputeCoefficientsIfNeeded() {
        let key =
            "\(eqEnabled)-\(bassDB)-\(midDB)-\(trebleDB)-\(bassBoostDB)-\(highpassOn)-\(Int(sampleRate))"
        guard key != lastKey else { return }
        lastKey = key

        let lowGain = eqEnabled ? bassDB : 0
        let midGain = eqEnabled ? midDB : 0
        let highGain = eqEnabled ? trebleDB : 0

        lowCoeffs = Self.lowShelf(frequency: 200, gainDB: lowGain, sampleRate: sampleRate)
        boostCoeffs = Self.lowShelf(frequency: 80, gainDB: bassBoostDB, sampleRate: sampleRate)
        midCoeffs = Self.peaking(frequency: 1000, gainDB: midGain, q: 0.7, sampleRate: sampleRate)
        highCoeffs = Self.highShelf(frequency: 4000, gainDB: highGain, sampleRate: sampleRate)
        hpCoeffs = highpassOn
            ? Self.highpass(frequency: 200, q: 0.7, sampleRate: sampleRate)
            : Biquad()
    }

    // MARK: - 処理

    func process(buffers: UnsafeMutablePointer<AudioBufferList>) {
        guard isPrepared else { return }
        recomputeCoefficientsIfNeeded()

        let abl = UnsafeMutableAudioBufferListPointer(buffers)
        guard abl.count > 0 else { return }
        let frameCount = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
        guard frameCount > 0 else { return }

        let vocal = max(0, min(1, vocalAmount))
        let dry = 1 - vocal
        let rotating = eightD
        let lfoStep = Float(2 * Double.pi * 0.12 / sampleRate)

        if isInterleaved || abl.count == 1 {
            // インターリーブ（ステレオ想定）
            guard let raw = abl[0].mData else { return }
            let data = raw.assumingMemoryBound(to: Float.self)
            let stride = channels
            for frame in 0..<frameCount {
                let base = frame * stride
                for channel in 0..<stride {
                    let index = base + channel
                    data[index] = processSample(data[index], channel: channel)
                }
                applySpatial(
                    &data[base], &data[min(base + 1, frameCount * stride - 1)],
                    stride: stride, vocal: vocal, dry: dry, rotating: rotating
                )
                eightDPhase += lfoStep
            }
        } else {
            // ノンインターリーブ（チャンネルごとにバッファ）
            let channelCount = min(channels, abl.count)
            var pointers: [UnsafeMutablePointer<Float>] = []
            for index in 0..<channelCount {
                guard let raw = abl[index].mData else { return }
                pointers.append(raw.assumingMemoryBound(to: Float.self))
            }
            if channelCount == 2 {
                let left = pointers[0]
                let right = pointers[1]
                for frame in 0..<frameCount {
                    left[frame] = processSample(left[frame], channel: 0)
                    right[frame] = processSample(right[frame], channel: 1)
                    applySpatial(&left[frame], &right[frame], stride: 1, vocal: vocal, dry: dry, rotating: rotating)
                    eightDPhase += lfoStep
                }
            } else {
                // モノラル: 空間処理は無効
                let mono = pointers[0]
                for frame in 0..<frameCount {
                    mono[frame] = processSample(mono[frame], channel: 0)
                }
            }
        }
    }

    private func processSample(_ input: Float, channel: Int) -> Float {
        var value = input
        value = hpCoeffs.process(value, state: &hpState[channel])
        value = lowCoeffs.process(value, state: &lowState[channel])
        value = boostCoeffs.process(value, state: &boostState[channel])
        value = midCoeffs.process(value, state: &midState[channel])
        value = highCoeffs.process(value, state: &highState[channel])
        return value
    }

    /// ボーカル除去（L/R位相キャンセル）と8D回転
    private func applySpatial(
        _ left: inout Float,
        _ right: inout Float,
        stride: Int,
        vocal: Float,
        dry: Float,
        rotating: Bool
    ) {
        var leftValue = left
        var rightValue = right

        if vocal > 0 {
            let mid = leftValue - rightValue
            let side = rightValue - leftValue
            leftValue = leftValue * dry + mid * vocal
            rightValue = rightValue * dry + side * vocal
        }

        if rotating {
            let angle = (1 + sin(eightDPhase)) * Float.pi / 4
            leftValue *= cos(angle) * 1.41421356
            rightValue *= sin(angle) * 1.41421356
        }

        left = leftValue
        right = rightValue
        _ = stride
    }

    // MARK: - フィルタ設計（RBJ Cookbook / 全てDoubleで計算して最後にFloatへ）

    static func lowShelf(frequency: Float, gainDB: Float, sampleRate: Double) -> Biquad {
        guard gainDB != 0 else { return Biquad() }
        let a = pow(10.0, Double(gainDB) / 40.0)
        let w0 = 2.0 * Double.pi * Double(frequency) / sampleRate
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let sqrtA = sqrt(a)
        let alpha = (sinW0 / 2.0) * sqrt((a + 1.0 / a) * (1.0 / 0.9 - 1.0) + 2.0)
        let a0 = (a + 1.0) + (a - 1.0) * cosW0 + 2.0 * sqrtA * alpha
        let b0 = a * ((a + 1.0) - (a - 1.0) * cosW0 + 2.0 * sqrtA * alpha) / a0
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosW0) / a0
        let b2 = a * ((a + 1.0) - (a - 1.0) * cosW0 - 2.0 * sqrtA * alpha) / a0
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosW0) / a0
        let a2 = ((a + 1.0) + (a - 1.0) * cosW0 - 2.0 * sqrtA * alpha) / a0
        return Biquad(b0: Float(b0), b1: Float(b1), b2: Float(b2), a1: Float(a1), a2: Float(a2))
    }

    static func highShelf(frequency: Float, gainDB: Float, sampleRate: Double) -> Biquad {
        guard gainDB != 0 else { return Biquad() }
        let a = pow(10.0, Double(gainDB) / 40.0)
        let w0 = 2.0 * Double.pi * Double(frequency) / sampleRate
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let sqrtA = sqrt(a)
        let alpha = (sinW0 / 2.0) * sqrt((a + 1.0 / a) * (1.0 / 0.9 - 1.0) + 2.0)
        let a0 = (a + 1.0) - (a - 1.0) * cosW0 + 2.0 * sqrtA * alpha
        let b0 = a * ((a + 1.0) + (a - 1.0) * cosW0 + 2.0 * sqrtA * alpha) / a0
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosW0) / a0
        let b2 = a * ((a + 1.0) + (a - 1.0) * cosW0 - 2.0 * sqrtA * alpha) / a0
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosW0) / a0
        let a2 = ((a + 1.0) - (a - 1.0) * cosW0 - 2.0 * sqrtA * alpha) / a0
        return Biquad(b0: Float(b0), b1: Float(b1), b2: Float(b2), a1: Float(a1), a2: Float(a2))
    }

    static func peaking(frequency: Float, gainDB: Float, q: Float, sampleRate: Double) -> Biquad {
        guard gainDB != 0 else { return Biquad() }
        let a = pow(10.0, Double(gainDB) / 40.0)
        let w0 = 2.0 * Double.pi * Double(frequency) / sampleRate
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let alpha = sinW0 / (2.0 * Double(q))
        let a0 = 1.0 + alpha / a
        let b0 = (1.0 + alpha * a) / a0
        let b1 = (-2.0 * cosW0) / a0
        let b2 = (1.0 - alpha * a) / a0
        let a1 = (-2.0 * cosW0) / a0
        let a2 = (1.0 - alpha / a) / a0
        return Biquad(b0: Float(b0), b1: Float(b1), b2: Float(b2), a1: Float(a1), a2: Float(a2))
    }

    static func highpass(frequency: Float, q: Float, sampleRate: Double) -> Biquad {
        let w0 = 2.0 * Double.pi * Double(frequency) / sampleRate
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let alpha = sinW0 / (2.0 * Double(q))
        let a0 = 1.0 + alpha
        let b0 = (1.0 + cosW0) / 2.0 / a0
        let b1 = -(1.0 + cosW0) / a0
        let b2 = (1.0 + cosW0) / 2.0 / a0
        let a1 = -2.0 * cosW0 / a0
        let a2 = (1.0 - alpha) / a0
        return Biquad(b0: Float(b0), b1: Float(b1), b2: Float(b2), a1: Float(a1), a2: Float(a2))
    }
}
