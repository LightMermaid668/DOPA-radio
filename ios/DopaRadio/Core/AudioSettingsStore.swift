import Foundation

/// オーディオ設定（スタジオ・速度・ピッチ）。UserDefaultsに永続化。
final class AudioSettingsStore: ObservableObject {
    static let shared = AudioSettingsStore()

    private let defaults = UserDefaults.standard

    // MARK: - 再生速度・ピッチ

    /// 0.5〜2.0（iOSネイティブの上限に合わせて2.0）
    @Published var userRate: Double {
        didSet { defaults.set(userRate, forKey: "dopa.rate") }
    }
    /// 速度変更でも声を変えない（キーロック）
    @Published var preservesPitch: Bool {
        didSet { defaults.set(preservesPitch, forKey: "dopa.preservesPitch") }
    }
    /// -12〜12 半音（サーバーで音源を生成）
    @Published var pitchSemitones: Int {
        didSet { defaults.set(pitchSemitones, forKey: "dopa.pitchSemitones") }
    }

    // MARK: - スタジオ（ネイティブDSP）

    @Published var eqEnabled: Bool {
        didSet { defaults.set(eqEnabled, forKey: "dopa.eqEnabled") }
    }
    /// -15〜15 dB
    @Published var eqBass: Double {
        didSet { defaults.set(eqBass, forKey: "dopa.eqBass") }
    }
    @Published var eqMid: Double {
        didSet { defaults.set(eqMid, forKey: "dopa.eqMid") }
    }
    @Published var eqTreble: Double {
        didSet { defaults.set(eqTreble, forKey: "dopa.eqTreble") }
    }
    /// 0〜15 dB（80Hzシェルフ）
    @Published var bassBoost: Double {
        didSet { defaults.set(bassBoost, forKey: "dopa.bassBoost") }
    }
    /// 0〜100（ボーカル除去）
    @Published var vocalRemoval: Double {
        didSet { defaults.set(vocalRemoval, forKey: "dopa.vocalRemoval") }
    }
    @Published var eightD: Bool {
        didSet { defaults.set(eightD, forKey: "dopa.eightD") }
    }

    // MARK: - DJミックス

    @Published var djMix: Bool {
        didSet { defaults.set(djMix, forKey: "dopa.djMix") }
    }

    var studioActive: Bool {
        eqEnabled || bassBoost > 0 || vocalRemoval > 0 || eightD || djMix
    }

    private init() {
        userRate = (defaults.object(forKey: "dopa.rate") as? Double) ?? 1
        preservesPitch = (defaults.object(forKey: "dopa.preservesPitch") as? Bool) ?? true
        pitchSemitones = (defaults.object(forKey: "dopa.pitchSemitones") as? Int) ?? 0
        eqEnabled = (defaults.object(forKey: "dopa.eqEnabled") as? Bool) ?? false
        eqBass = (defaults.object(forKey: "dopa.eqBass") as? Double) ?? 0
        eqMid = (defaults.object(forKey: "dopa.eqMid") as? Double) ?? 0
        eqTreble = (defaults.object(forKey: "dopa.eqTreble") as? Double) ?? 0
        bassBoost = (defaults.object(forKey: "dopa.bassBoost") as? Double) ?? 0
        vocalRemoval = (defaults.object(forKey: "dopa.vocalRemoval") as? Double) ?? 0
        eightD = (defaults.object(forKey: "dopa.eightD") as? Bool) ?? false
        djMix = (defaults.object(forKey: "dopa.djMix") as? Bool) ?? false
        userRate = min(2.0, max(0.5, userRate))
    }
}
