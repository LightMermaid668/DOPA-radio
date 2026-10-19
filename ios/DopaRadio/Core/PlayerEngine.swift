import AVFoundation
import Combine
import MediaPlayer
#if os(iOS)
import UIKit
typealias NowPlayingImage = UIImage
#else
import AppKit
typealias NowPlayingImage = NSImage
#endif

/// リピートモード
enum RepeatMode: Int {
    case off = 0
    case all = 1
    case one = 2
}

/// AVPlayer 2台（A/B）を使ったネイティブプレイヤー。
///
/// 設計（Web版の知見をネイティブに移植）:
/// - クロスフェード: 終端の数秒前に次曲をBで先読み再生し、音量をイコールパワーでランプして昇格
/// - 進行は「タイマー + 両プレイヤーのperiodicTimeObserver + didPlayToEndTime通知」の多重駆動
/// - 'ended' を取りこぼしても必ず進む（ウォッチドッグ的チェック）
/// - 昇格時は先読みが失敗していないか検証し、ダメなら通常開始にフォールバック
/// - サビだけ / ドパモード / 速度 / ピッチ（サーバー生成）/ スタジオDSP（Tap）/ DJミックス
@MainActor
final class PlayerEngine: ObservableObject {
    // MARK: - 公開状態

    @Published private(set) var queue: [PlayerTrack] = []
    @Published private(set) var index = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var isCrossfading = false
    @Published var playbackError: String?
    @Published private(set) var notice: String?

    @Published var crossfadeEnabled: Bool {
        didSet {
            UserDefaults.standard.set(crossfadeEnabled, forKey: "dopa.crossfade")
            if !crossfadeEnabled { cancelCrossfade() }
        }
    }

    @Published var chorusOnly: Bool {
        didSet { UserDefaults.standard.set(chorusOnly, forKey: "dopa.chorus") }
    }

    @Published var dopaMode: Bool {
        didSet { UserDefaults.standard.set(dopaMode, forKey: "dopa.dopa") }
    }

    @Published var repeatMode: RepeatMode = .off {
        didSet { UserDefaults.standard.set(repeatMode.rawValue, forKey: "dopa.repeat") }
    }

    @Published var shuffleEnabled: Bool = false {
        didSet {
            UserDefaults.standard.set(shuffleEnabled, forKey: "dopa.shuffle")
            applyShuffleChange()
        }
    }

    /// リピート/ドパモードを考慮して先へ進めるか
    var canAdvance: Bool { index + 1 < queue.count || (repeatMode == .all && !queue.isEmpty) }

    func cycleRepeatMode() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
    }

    var crossfadeSeconds: Double = 3.0

    let settings = AudioSettingsStore.shared

    var currentTrack: PlayerTrack? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    var hasNext: Bool { index + 1 < queue.count }

    /// 次に再生される曲（キュー表示用）
    var upNext: [PlayerTrack] {
        guard queue.indices.contains(index) else { return [] }
        return Array(queue.dropFirst(index + 1))
    }

    // MARK: - Private

    private let playerA = AVPlayer()
    private let playerB = AVPlayer()
    private var mainIsA = true

    private var main: AVPlayer { mainIsA ? playerA : playerB }
    private var secondary: AVPlayer { mainIsA ? playerB : playerA }

    private var pendingNextIndex: Int?
    private var crossfadeStartedAt: Date?
    private var crossfadeDuration: Double = 3.0
    private var djSwapDone = false

    private var ticker: Timer?
    private var timeObserverTokens: [Any] = []
    private var lastNowPlayingUpdate = Date.distantPast
    private var lastArtworkTrackId: String?
    private var nowPlayingArtwork: MPMediaItemArtwork?
    private var artworkTrackId: String?

    // サビだけ / フェード
    private var effectiveEndSec: Double?
    private var chorusFadeArmed = false
    private var volumeFadeTask: Task<Void, Never>?

    // ドパモード
    private var radioFetching = false
    private var radioCooldownUntil = Date.distantPast

    // ピッチ（サーバー生成の音源）
    private var pitchReadyKeys: Set<String> = []
    private var startGeneration = 0
    private var lastAppliedPitch = 0

    // スタジオDSP
    private var mainDSP: TapDSP?
    private var secondaryDSP: TapDSP?

    // 誤連続送りガード
    private var lastAdvanceAt = Date.distantPast

    private var cancellables = Set<AnyCancellable>()

    init() {
        crossfadeEnabled =
            (UserDefaults.standard.object(forKey: "dopa.crossfade") as? Bool) ?? true
        chorusOnly = (UserDefaults.standard.object(forKey: "dopa.chorus") as? Bool) ?? false
        dopaMode = (UserDefaults.standard.object(forKey: "dopa.dopa") as? Bool) ?? false
        repeatMode = RepeatMode(rawValue: UserDefaults.standard.integer(forKey: "dopa.repeat")) ?? .off
        shuffleEnabled = (UserDefaults.standard.object(forKey: "dopa.shuffle") as? Bool) ?? false
        lastAppliedPitch = settings.pitchSemitones

        for player in [playerA, playerB] {
            player.actionAtItemEnd = .pause
            player.volume = 1
            player.defaultRate = Float(clampedRate(settings.userRate))
        }

        setupRemoteCommands()
        observeNotifications()
        startTicker()
        startTimeObservers()

        // 設定変更を反映（objectWillChangeは変更前に発火するため次のrunloopで読む）
        settings.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.settingsDidChange()
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - 再生API

    func play(tracks: [PlayerTrack], startAt startIndex: Int) {
        let playable = tracks.filter { $0.streamURL != nil }
        guard !playable.isEmpty else { return }
        queue = playable
        index = min(max(startIndex, 0), playable.count - 1)
        if shuffleEnabled {
            unshuffledQueue = queue
            reshuffleUpcoming()
        } else {
            unshuffledQueue = nil
        }
        startCurrent(from: 0)
    }

    func togglePlay() {
        guard currentTrack != nil else { return }
        Haptics.tap()
        if isPlaying {
            main.pause()
            isPlaying = false
        } else {
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setActive(true)
            #endif
            main.play()
            isPlaying = true
        }
        updateNowPlaying(force: true)
    }

    func next(userInitiated: Bool = true) {
        guard !queue.isEmpty else { return }
        if userInitiated { Haptics.tap() }
        cancelCrossfade()

        // リピート1曲: 自動送りのときだけ同じ曲を先頭から再生し直す
        if !userInitiated, repeatMode == .one {
            main.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            progress = 0
            main.play()
            isPlaying = true
            updateNowPlaying(force: true)
            return
        }

        if index + 1 < queue.count {
            index += 1
            startCurrent(from: 0)
            return
        }
        if repeatMode == .all {
            index = 0
            startCurrent(from: 0)
            return
        }
        if dopaMode {
            Task { await extendWithRadio() }
            return
        }
        main.pause()
        isPlaying = false
        progress = 0
        updateNowPlaying(force: true)
    }

    func previous() {
        guard !queue.isEmpty else { return }
        Haptics.tap()
        cancelCrossfade()
        if progress > 3 {
            main.seek(to: .zero)
            progress = 0
            return
        }
        if index > 0 {
            index -= 1
        } else if repeatMode == .all {
            index = queue.count - 1
        }
        startCurrent(from: 0)
    }

    /// キュー内の指定位置へジャンプ
    func playIndex(_ target: Int) {
        guard queue.indices.contains(target), target != index else { return }
        Haptics.tap()
        cancelCrossfade()
        index = target
        startCurrent(from: 0)
    }

    /// 「次に再生」: 現在の曲の直後に割り込む（既にキューにあれば移動）
    func playNext(_ track: PlayerTrack) {
        Haptics.tap()
        guard let currentId = currentTrack?.id else {
            play(tracks: [track], startAt: 0)
            return
        }
        if let existing = queue.firstIndex(where: { $0.id == track.id }) {
            let removedBeforeCurrent = existing < index
            queue.remove(at: existing)
            if removedBeforeCurrent { index -= 1 }
        }
        let currentPosition = queue.firstIndex(where: { $0.id == currentId }) ?? index
        queue.insert(track, at: min(currentPosition + 1, queue.count))
    }

    /// おやすみタイマーなどで使用
    func pause() {
        main.pause()
        isPlaying = false
        updateNowPlaying(force: true)
    }

    // MARK: - シャッフル

    private var unshuffledQueue: [PlayerTrack]?

    private func applyShuffleChange() {
        if shuffleEnabled {
            guard unshuffledQueue == nil else { return }
            unshuffledQueue = queue
            reshuffleUpcoming()
        } else {
            restoreOriginalOrder()
        }
    }

    /// 現在の曲より後ろだけをシャッフルする
    private func reshuffleUpcoming() {
        guard let currentId = currentTrack?.id,
            let currentPos = queue.firstIndex(where: { $0.id == currentId })
        else { return }
        var rest = Array(queue.dropFirst(currentPos + 1))
        rest.shuffle()
        queue = Array(queue.prefix(currentPos + 1)) + rest
    }

    /// シャッフル解除時に元の並びへ戻す（曲の増減がある場合は現状維持）
    private func restoreOriginalOrder() {
        guard let original = unshuffledQueue else { return }
        unshuffledQueue = nil
        guard let currentId = currentTrack?.id,
            original.count == queue.count,
            Set(original.map(\.id)) == Set(queue.map(\.id)),
            let originalPos = original.firstIndex(where: { $0.id == currentId })
        else { return }
        queue = original
        index = originalPos
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        main.seek(
            to: CMTime(seconds: seconds, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        progress = seconds
    }

    func removeFromQueue(trackId: String) {
        guard let removeIndex = queue.firstIndex(where: { $0.id == trackId }) else { return }
        queue.remove(at: removeIndex)
        if removeIndex < index {
            index -= 1
        } else if removeIndex == index {
            cancelCrossfade()
            index = min(index, max(queue.count - 1, 0))
            if queue.isEmpty {
                main.pause()
                isPlaying = false
                progress = 0
                duration = 0
            } else {
                startCurrent(from: 0)
            }
        }
    }

    // MARK: - 開始処理

    private func startCurrent(from position: Double) {
        guard let track = currentTrack else { return }
        startGeneration += 1
        let generation = startGeneration

        // ピッチ変更時はサーバー生成の音源を使う（生成完了まで待つ）
        if settings.pitchSemitones != 0, track.directURL == nil {
            let semitones = settings.pitchSemitones
            notice = "ピッチ音源を準備しています…（初回のみ・数秒）"
            Task { [weak self] in
                guard let self else { return }
                let ready = await self.ensurePitchVariant(trackId: track.id, semitones: semitones)
                guard generation == self.startGeneration else { return }
                guard self.currentTrack?.id == track.id else { return }
                self.notice = nil
                let variantURL = ready ? self.pitchVariantURL(trackId: track.id, semitones: semitones) : nil
                if !ready {
                    self.notice = "ピッチ音源を用意できませんでした（通常音源で再生）"
                }
                self.actuallyStart(track: track, url: variantURL ?? track.streamURL, from: position)
            }
            return
        }

        notice = nil
        actuallyStart(track: track, url: track.streamURL, from: position)
    }

    private func actuallyStart(track: PlayerTrack, url: URL?, from position: Double) {
        guard let url else { return }
        cancelCrossfade()
        let item = AVPlayerItem(url: url)
        item.audioTimePitchAlgorithm = settings.preservesPitch ? .spectral : .varispeed
        let rate = Float(clampedRate(settings.userRate))
        main.defaultRate = rate
        main.replaceCurrentItem(with: item)
        main.volume = 1

        // スタジオ（Tap）を接続
        if settings.studioActive {
            let dsp = TapDSP()
            applySettings(to: dsp)
            mainDSP = dsp
            StudioTap.attach(to: item, dsp: dsp)
        }

        effectiveEndSec = nil
        chorusFadeArmed = false

        // サビだけモード: 終端はサビ終わり、開始はサビ頭から
        var seekTarget = position
        if chorusOnly, let start = track.chorusStartSec, let end = track.chorusEndSec,
            end - start >= 5
        {
            effectiveEndSec = Double(end)
            if start > 1, position <= 3 {
                seekTarget = Double(start)
            }
        }

        if seekTarget > 0 {
            main.seek(to: CMTime(seconds: seekTarget, preferredTimescale: 600))
        }
        main.play()
        if rate != 1 {
            main.rate = rate
        }
        isPlaying = true
        playbackError = nil

        if chorusOnly, seekTarget > 1, position <= 3 {
            main.volume = 0
            rampVolume(to: 1, duration: 0.8)
        }
        updateNowPlaying(force: true)

        // 次曲のピッチ音源を先読み
        if settings.pitchSemitones != 0, queue.indices.contains(index + 1) {
            let nextTrack = queue[index + 1]
            if nextTrack.directURL == nil {
                Task { [weak self] in
                    _ = await self?.ensurePitchVariant(
                        trackId: nextTrack.id, semitones: self?.settings.pitchSemitones ?? 0
                    )
                }
            }
        }

        // DJミックスのテンポ同期用にBPMを解析（バックグラウンド・結果はキャッシュ）
        if settings.djMix, track.directURL == nil {
            if let url = track.streamURL {
                TempoAnalyzer.analyze(trackId: track.id, url: url)
            }
            if queue.indices.contains(index + 1), let url = queue[index + 1].streamURL {
                TempoAnalyzer.analyze(trackId: queue[index + 1].id, url: url)
            }
        }
    }

    private func cancelCrossfade() {
        crossfadeStartedAt = nil
        pendingNextIndex = nil
        isCrossfading = false
        djSwapDone = false
        secondary.pause()
        secondary.replaceCurrentItem(with: nil)
        secondary.volume = 1
        main.volume = 1
        mainDSP?.highpassOn = false
        secondaryDSP = nil
    }

    private func beginCrossfade() {
        guard pendingNextIndex == nil, !queue.isEmpty else { return }
        // リピート1曲のときはクロスフェードしない（同じ曲を頭から再生）
        guard repeatMode != .one else { return }
        let wrapped = index + 1 >= queue.count
        // リピート全曲なら先頭へ戻ってクロスフェード
        guard !wrapped || repeatMode == .all else { return }
        let nextIndex = wrapped ? 0 : index + 1
        guard queue.indices.contains(nextIndex), let url = queue[nextIndex].streamURL else { return }

        pendingNextIndex = nextIndex
        isCrossfading = true
        djSwapDone = false
        crossfadeStartedAt = Date()
        crossfadeDuration = crossfadeSeconds

        let next = secondary
        let item = AVPlayerItem(url: url)
        item.audioTimePitchAlgorithm = settings.preservesPitch ? .spectral : .varispeed

        // DJミックス: BPMが分かっていればテンポを合わせる（キーロック）
        var incomingRate = clampedRate(settings.userRate)
        if settings.djMix, let currentPlayTrack = currentTrack {
            let bpmA = TempoAnalyzer.cachedBPM(trackId: currentPlayTrack.id)
            let bpmB = TempoAnalyzer.cachedBPM(trackId: queue[nextIndex].id)
            if let bpmA, let bpmB, bpmB > 0 {
                let ratio = bpmA / bpmB
                if ratio >= 0.9 && ratio <= 1.12 {
                    incomingRate = clampedRate(settings.userRate * ratio)
                }
            }
        }

        next.defaultRate = Float(incomingRate)
        next.replaceCurrentItem(with: item)
        next.volume = 0
        next.play()
        if incomingRate != 1 {
            next.rate = Float(incomingRate)
        }

        // 入ってくる側のスタジオ（DJミックス時は最初ベースを抜く）
        if settings.studioActive {
            let dsp = TapDSP()
            applySettings(to: dsp)
            if settings.djMix { dsp.highpassOn = true }
            secondaryDSP = dsp
            StudioTap.attach(to: item, dsp: dsp)
        } else {
            secondaryDSP = nil
        }
    }

    private func completeCrossfade() {
        guard let nextIndex = pendingNextIndex else { return }
        pendingNextIndex = nil
        crossfadeStartedAt = nil
        isCrossfading = false

        let incoming = secondary
        let incomingReady: Bool = {
            guard let item = incoming.currentItem else { return false }
            return item.status == .readyToPlay && incoming.error == nil
        }()

        if !incomingReady {
            // 先読みが失敗していたら通常開始に任せる（無音昇格を防ぐ）
            incoming.pause()
            incoming.replaceCurrentItem(with: nil)
            secondaryDSP = nil
            djSwapDone = false
            mainDSP?.highpassOn = false
            index = nextIndex
            progress = 0
            isPlaying = true
            startCurrent(from: 0)
            return
        }

        if incoming.rate == 0 {
            incoming.play()
        }

        let oldMain = main
        oldMain.pause()
        oldMain.replaceCurrentItem(with: nil)
        oldMain.volume = 1

        mainIsA.toggle()
        main.volume = 1
        mainDSP = secondaryDSP
        secondaryDSP = nil
        mainDSP?.highpassOn = false
        djSwapDone = false
        index = nextIndex
        progress = 0
        isPlaying = true

        // テンポ同期で変えていた速度をユーザー設定に戻す
        let userRate = Float(clampedRate(settings.userRate))
        main.defaultRate = userRate
        main.rate = userRate
        updateNowPlaying(force: true)
    }

    // MARK: - 進行監視（多重駆動）

    private func startTicker() {
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    /// AVPlayerのperiodicTimeObserverでも進める（バックグラウンドやタイマー揺れ対策）
    private func startTimeObservers() {
        for player in [playerA, playerB] {
            let token = player.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.tick()
                }
            }
            timeObserverTokens.append(token)
        }
    }

    private func tick() {
        guard let item = main.currentItem else {
            if !queue.isEmpty && isPlaying && main.rate == 0 {
                startCurrent(from: progress)
            }
            return
        }

        // アイテム失敗（無音のまま進まない事故を防ぐ）
        if item.status == .failed {
            playbackError = item.error?.localizedDescription ?? "再生に失敗しました"
            if canAdvance {
                next(userInitiated: false)
            } else {
                main.pause()
                isPlaying = false
            }
            return
        }

        let current = main.currentTime().seconds
        if current.isFinite {
            progress = max(0, current)
        }
        let itemDuration = item.duration.seconds
        if itemDuration.isFinite && itemDuration > 0 {
            duration = itemDuration
        }

        // 終端（サビだけ時はサビ終わり）
        let endTime = effectiveEndSec ?? (itemDuration.isFinite ? itemDuration : 0)

        // クロスフェードのランプ進行（タイマー駆動なのでバックグラウンドのタスク停止に強い）
        if let startedAt = crossfadeStartedAt, pendingNextIndex != nil {
            let elapsed = Date().timeIntervalSince(startedAt)
            let ratio = min(1, max(0, elapsed / crossfadeDuration))
            secondary.volume = Float(sin(ratio * Double.pi / 2))
            main.volume = Float(cos(ratio * Double.pi / 2))

            // DJミックス: 中間でベーススワップ
            if settings.djMix, !djSwapDone, ratio >= 0.5 {
                djSwapDone = true
                mainDSP?.highpassOn = true
                secondaryDSP?.highpassOn = false
            }

            if ratio >= 1 {
                completeCrossfade()
                return
            }
        }

        // 終端に達したら次へ進む（'ended'が来なくても必ず進む）
        if isPlaying, endTime > 0, progress >= endTime - 0.12, !isCrossfading {
            if Date().timeIntervalSince(lastAdvanceAt) < 0.6 {
                return
            }
            lastAdvanceAt = Date()
            if pendingNextIndex != nil {
                completeCrossfade()
            } else {
                next(userInitiated: false)
            }
            return
        }

        // 予期せぬ停止からの復帰
        if isPlaying && main.rate == 0 && item.status == .readyToPlay
            && !isCrossfading
            && (endTime == 0 || progress < endTime - 1)
        {
            main.play()
        }

        // クロスフェード開始判定（終端 = サビ終わりの場合はそこを基準にする）
        if isPlaying, crossfadeEnabled, pendingNextIndex == nil,
            repeatMode != .one,
            endTime > crossfadeSeconds + 1,
            endTime - progress <= crossfadeSeconds,
            canAdvance
        {
            beginCrossfade()
        }

        // サビだけモードの終端フェードアウト（クロスフェード中は任せる）
        if chorusOnly, effectiveEndSec != nil, isPlaying, !isCrossfading, !chorusFadeArmed {
            let remaining = endTime - progress
            if remaining <= 0.9, remaining > 0.05 {
                chorusFadeArmed = true
                rampVolume(to: 0, duration: max(0.15, remaining - 0.05))
            }
        }

        // ドパモードの先読み
        maybePrefetchRadio()

        if isPlaying, Date().timeIntervalSince(lastNowPlayingUpdate) >= 1 {
            updateNowPlaying()
        }
    }

    // MARK: - 音量フェード（サビメドレー用）

    private func rampVolume(to target: Float, duration: Double) {
        volumeFadeTask?.cancel()
        let start = main.volume
        let steps = 24
        let stepNanos = UInt64(max(0.02, duration / Double(steps)) * 1_000_000_000)
        volumeFadeTask = Task { [weak self] in
            guard let self else { return }
            for step in 1...steps {
                try? await Task.sleep(nanoseconds: stepNanos)
                if Task.isCancelled { return }
                let ratio = Float(step) / Float(steps)
                self.main.volume = start + (target - start) * ratio
            }
        }
    }

    // MARK: - 速度・ピッチ

    private func clampedRate(_ rate: Double) -> Double {
        min(2.0, max(0.5, rate))
    }

    private func settingsDidChange() {
        let rate = Float(clampedRate(settings.userRate))
        for player in [playerA, playerB] {
            player.defaultRate = rate
            if let item = player.currentItem {
                item.audioTimePitchAlgorithm = settings.preservesPitch ? .spectral : .varispeed
            }
        }
        if isPlaying, !isCrossfading {
            main.rate = rate
        }

        applySettings(to: mainDSP)
        applySettings(to: secondaryDSP)

        // スタジオを後からONにしたら現在のアイテムへ接続
        if settings.studioActive, mainDSP == nil, let item = main.currentItem {
            let dsp = TapDSP()
            applySettings(to: dsp)
            mainDSP = dsp
            StudioTap.attach(to: item, dsp: dsp)
        }

        // ピッチ変更 → 現在の曲を再スタート（同じ位置から）
        if settings.pitchSemitones != lastAppliedPitch {
            lastAppliedPitch = settings.pitchSemitones
            if currentTrack?.directURL == nil, currentTrack != nil {
                startCurrent(from: progress)
            }
        }
    }

    private func applySettings(to dsp: TapDSP?) {
        guard let dsp else { return }
        dsp.eqEnabled = settings.eqEnabled
        dsp.bassDB = Float(settings.eqBass)
        dsp.midDB = Float(settings.eqMid)
        dsp.trebleDB = Float(settings.eqTreble)
        dsp.bassBoostDB = Float(settings.bassBoost)
        dsp.vocalAmount = Float(settings.vocalRemoval / 100)
        dsp.eightD = settings.eightD
    }

    // MARK: - ピッチ音源（サーバー生成）

    private func pitchVariantURL(trackId: String, semitones: Int) -> URL? {
        URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(trackId)/pitch/\(semitones)")
    }

    private func ensurePitchVariant(trackId: String, semitones: Int) async -> Bool {
        let key = "\(trackId):\(semitones)"
        if pitchReadyKeys.contains(key) { return true }

        struct StatusResponse: Decodable {
            let status: String?
        }
        for _ in 0..<40 {
            do {
                let response = try await APIClient.shared.get(
                    "/api/tracks/\(trackId)/pitch/\(semitones)?check=1",
                    as: StatusResponse.self
                )
                if response.status == "ready" {
                    pitchReadyKeys.insert(key)
                    return true
                }
                if response.status != "processing" {
                    return false
                }
            } catch {
                return false
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        return false
    }

    // MARK: - ドパモード（似てる曲の自動追加）

    private func fetchRadioTracks() async -> [PlayerTrack] {
        let seed = queue.last(where: { $0.localURL == nil })?.id
        let exclude = queue.map { $0.id }.suffix(50).joined(separator: ",")
        var path = "/api/radio/next?"
        if let seed, let encoded = seed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "seed=\(encoded)&"
        }
        if let encodedExclude = exclude.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) {
            path += "exclude=\(encodedExclude)"
        }
        do {
            let response = try await APIClient.shared.get(path, as: RadioNextResponse.self)
            return response.tracks.map { $0.toPlayerTrack }
        } catch {
            return []
        }
    }

    private func maybePrefetchRadio() {
        guard dopaMode, !radioFetching, Date() > radioCooldownUntil else { return }
        guard index >= queue.count - 2 else { return }
        radioFetching = true
        Task { [weak self] in
            guard let self else { return }
            let additions = await self.fetchRadioTracks()
            self.radioFetching = false
            if additions.isEmpty {
                self.radioCooldownUntil = Date().addingTimeInterval(60)
                return
            }
            self.queue.append(contentsOf: additions)
        }
    }

    private func extendWithRadio() async {
        guard !radioFetching else { return }
        radioFetching = true
        let additions = await fetchRadioTracks()
        radioFetching = false
        guard !additions.isEmpty else {
            radioCooldownUntil = Date().addingTimeInterval(60)
            main.pause()
            isPlaying = false
            progress = 0
            updateNowPlaying(force: true)
            return
        }
        let startIndex = queue.count
        queue.append(contentsOf: additions)
        index = startIndex
        startCurrent(from: 0)
    }

    // MARK: - 通知（曲の終端・割り込み）

    private func observeNotifications() {
        NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                guard let self,
                    let endedItem = notification.object as? AVPlayerItem,
                    endedItem === self.main.currentItem
                else { return }
                if Date().timeIntervalSince(self.lastAdvanceAt) < 0.6 { return }
                self.lastAdvanceAt = Date()
                if self.pendingNextIndex != nil {
                    self.completeCrossfade()
                } else {
                    self.next(userInitiated: false)
                }
            }
        }

        #if os(iOS)
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                guard let self,
                    let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    let type = AVAudioSession.InterruptionType(rawValue: raw)
                else { return }
                switch type {
                case .began:
                    // Apple Music等にセッションを取られたら、UI状態とクロスフェードを整理する
                    self.isPlaying = false
                    self.cancelCrossfade()
                    self.updateNowPlaying(force: true)
                case .ended:
                    let optionsRaw = notification.userInfo?[
                        AVAudioSessionInterruptionOptionKey
                    ] as? UInt ?? 0
                    let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
                    if options.contains(.shouldResume), self.currentTrack != nil {
                        try? AVAudioSession.sharedInstance().setActive(true)
                        self.main.play()
                        self.isPlaying = true
                        self.updateNowPlaying(force: true)
                    }
                @unknown default:
                    break
                }
            }
        }
        #endif
    }

    // MARK: - ロック画面 / Now Playing

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.main.play()
                self?.isPlaying = true
            }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.main.pause()
                self?.isPlaying = false
            }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.togglePlay()
            }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.next()
            }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.previous()
            }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent
            else { return .commandFailed }
            Task { @MainActor in
                self?.seek(to: positionEvent.positionTime)
            }
            return .success
        }
    }

    private func updateNowPlaying(force: Bool = false) {
        lastNowPlayingUpdate = Date()
        guard let track = currentTrack else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist ?? "DOPA-radio",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: progress,
            MPNowPlayingInfoPropertyPlaybackRate: (isPlaying ? 1.0 : 0.0) * settings.userRate,
        ]

        if let artwork = nowPlayingArtwork, artworkTrackId == track.id {
            info[MPMediaItemPropertyArtwork] = artwork
        } else if lastArtworkTrackId != track.id {
            loadArtwork(for: track)
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(for track: PlayerTrack) {
        lastArtworkTrackId = track.id
        guard let url = track.artworkURL else { return }
        Task { [weak self] in
            guard let data = await APIClient.shared.fetchData(url),
                let image = NowPlayingImage(data: data)
            else { return }
            await MainActor.run {
                guard let self else { return }
                self.nowPlayingArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artworkTrackId = track.id
                self.updateNowPlaying(force: true)
            }
        }
    }
}
