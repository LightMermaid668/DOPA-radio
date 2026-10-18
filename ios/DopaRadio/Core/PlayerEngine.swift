import AVFoundation
import Combine
import MediaPlayer
import UIKit

/// AVPlayer 2台（A/B）を使ったネイティブプレイヤー。
/// クロスフェードは「終端の数秒前に次曲をBで先読み再生し、音量をランプして昇格」する方式
/// （Web版と同じ設計。ネイティブは音量が自由なので焼き込み不要）。
@MainActor
final class PlayerEngine: ObservableObject {
    @Published private(set) var queue: [PlayerTrack] = []
    @Published private(set) var index = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var isCrossfading = false
    @Published var playbackError: String?

    @Published var crossfadeEnabled: Bool {
        didSet {
            UserDefaults.standard.set(crossfadeEnabled, forKey: "dopa.crossfade")
            if !crossfadeEnabled { cancelCrossfade() }
        }
    }

    /// サビだけモード（サビ範囲が設定された曲はサビ部分だけ再生）
    @Published var chorusOnly: Bool {
        didSet { UserDefaults.standard.set(chorusOnly, forKey: "dopa.chorus") }
    }

    /// ドパモード（キューが終わると似てる曲を自動追加）
    @Published var dopaMode: Bool {
        didSet { UserDefaults.standard.set(dopaMode, forKey: "dopa.dopa") }
    }

    var crossfadeSeconds: Double = 3.0

    var currentTrack: PlayerTrack? {
        queue.indices.contains(index) ? queue[index] : nil
    }

    var hasNext: Bool { index + 1 < queue.count }

    // MARK: - Private

    private let playerA = AVPlayer()
    private let playerB = AVPlayer()
    private var mainIsA = true

    private var main: AVPlayer { mainIsA ? playerA : playerB }
    private var secondary: AVPlayer { mainIsA ? playerB : playerA }

    private var pendingNextIndex: Int?
    private var crossfadeTask: Task<Void, Never>?
    private var ticker: Timer?
    private var lastNowPlayingUpdate = Date.distantPast
    private var lastArtworkTrackId: String?

    // サビだけ / フェード / ドパモード用
    private var effectiveEndSec: Double?
    private var chorusFadeArmed = false
    private var volumeFadeTask: Task<Void, Never>?
    private var radioFetching = false
    private var radioCooldownUntil = Date.distantPast

    init() {
        crossfadeEnabled =
            (UserDefaults.standard.object(forKey: "dopa.crossfade") as? Bool) ?? true
        chorusOnly = (UserDefaults.standard.object(forKey: "dopa.chorus") as? Bool) ?? false
        dopaMode = (UserDefaults.standard.object(forKey: "dopa.dopa") as? Bool) ?? false

        for player in [playerA, playerB] {
            player.actionAtItemEnd = .pause
            player.volume = 1
        }

        setupRemoteCommands()
        observeNotifications()
        startTicker()
    }

    // MARK: - 再生API

    func play(tracks: [PlayerTrack], startAt startIndex: Int) {
        let playable = tracks.filter { $0.streamURL != nil }
        guard !playable.isEmpty else { return }
        queue = playable
        index = min(max(startIndex, 0), playable.count - 1)
        startCurrent(from: 0)
    }

    func togglePlay() {
        guard currentTrack != nil else { return }
        if isPlaying {
            main.pause()
            isPlaying = false
        } else {
            main.play()
            isPlaying = true
        }
        updateNowPlaying(force: true)
    }

    func next(userInitiated: Bool = true) {
        guard !queue.isEmpty else { return }
        cancelCrossfade()
        if index + 1 < queue.count {
            index += 1
            startCurrent(from: 0)
            return
        }
        if dopaMode {
            // 似てる曲を取ってきて続ける
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
        cancelCrossfade()
        if progress > 3 {
            main.seek(to: .zero)
            progress = 0
            return
        }
        index = max(0, index - 1)
        startCurrent(from: 0)
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

    // MARK: - 内部処理

    private func startCurrent(from position: Double) {
        guard let track = currentTrack, let url = track.streamURL else { return }
        cancelCrossfade()
        let item = AVPlayerItem(url: url)
        main.replaceCurrentItem(with: item)
        main.volume = 1
        effectiveEndSec = nil
        chorusFadeArmed = false

        // サビだけモード: 終端をサビ終わりにして、開始はサビ頭から
        var seekTarget = position
        if chorusOnly, let start = track.chorusStartSec, let end = track.chorusEndSec,
            end - start >= 5
        {
            effectiveEndSec = Double(end)
            item.forwardPlaybackEndTime = CMTime(seconds: Double(end), preferredTimescale: 600)
            if start > 1, position <= 3 {
                seekTarget = Double(start)
            }
        }

        if seekTarget > 0 {
            main.seek(to: CMTime(seconds: seekTarget, preferredTimescale: 600))
        }
        main.play()
        isPlaying = true
        playbackError = nil

        // サビ頭・頭出し時はフェードイン（ネイティブは音量が使える）
        if chorusOnly, seekTarget > 1, position <= 3 {
            main.volume = 0
            rampVolume(to: 1, duration: 0.8)
        }
        updateNowPlaying(force: true)
    }

    private func cancelCrossfade() {
        crossfadeTask?.cancel()
        crossfadeTask = nil
        pendingNextIndex = nil
        isCrossfading = false
        secondary.pause()
        secondary.replaceCurrentItem(with: nil)
        secondary.volume = 1
        main.volume = 1
    }

    private func beginCrossfade() {
        guard pendingNextIndex == nil else { return }
        let nextIndex = index + 1
        guard queue.indices.contains(nextIndex), let url = queue[nextIndex].streamURL else { return }

        pendingNextIndex = nextIndex
        isCrossfading = true

        let next = secondary
        next.replaceCurrentItem(with: AVPlayerItem(url: url))
        next.volume = 0
        next.play()

        let steps = 30
        let stepNanos = UInt64((crossfadeSeconds / Double(steps)) * 1_000_000_000)
        crossfadeTask = Task { [weak self] in
            guard let self else { return }
            for step in 1...steps {
                try? await Task.sleep(nanoseconds: stepNanos)
                if Task.isCancelled { return }
                let ratio = Float(step) / Float(steps)
                self.secondary.volume = ratio
                self.main.volume = 1 - ratio
            }
            if Task.isCancelled { return }
            self.completeCrossfade()
        }
    }

    private func completeCrossfade() {
        guard let nextIndex = pendingNextIndex else { return }
        pendingNextIndex = nil
        crossfadeTask = nil
        isCrossfading = false

        let oldMain = main
        oldMain.pause()
        oldMain.replaceCurrentItem(with: nil)
        oldMain.volume = 1

        mainIsA.toggle()
        main.volume = 1
        index = nextIndex
        progress = 0
        isPlaying = true
        updateNowPlaying(force: true)
    }

    // MARK: - 進行監視（クロスフェード開始・復旧・進捗）

    private func startTicker() {
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard let item = main.currentItem else {
            if !queue.isEmpty && isPlaying && main.rate == 0 {
                // 何らかの理由でアイテムが外れていたら復帰させる
                startCurrent(from: progress)
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

        // サビだけモードではサビ終わりが実質の終端
        let endTime: Double
        if let effectiveEndSec {
            endTime = effectiveEndSec
        } else if itemDuration.isFinite {
            endTime = itemDuration
        } else {
            endTime = 0
        }

        // 終端に達したら次へ進む（'ended'が来なくても必ず進む）
        if isPlaying, endTime > 0, progress >= endTime - 0.12, !isCrossfading {
            if pendingNextIndex != nil {
                secondary.volume = 1
                completeCrossfade()
            } else {
                next(userInitiated: false)
            }
            return
        }

        // 予期せぬ停止からの復帰（割り込み等）
        if isPlaying && main.rate == 0 && item.status == .readyToPlay
            && !isCrossfading
            && (endTime == 0 || progress < endTime - 1)
        {
            main.play()
        }

        // クロスフェード開始判定（終端 = サビ終わりの場合はそこを基準にする）
        if isPlaying, crossfadeEnabled, pendingNextIndex == nil,
            endTime > crossfadeSeconds + 1,
            endTime - progress <= crossfadeSeconds,
            hasNext
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

        // Now Playing は1秒に1回程度更新
        if Date().timeIntervalSince(lastNowPlayingUpdate) >= 1 {
            updateNowPlaying()
        }
    }

    // MARK: - 音量フェード（サビメドレー用 / ネイティブ音量）

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

    // MARK: - 通知（曲の終端・割り込み・ルート変更）

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
                if self.pendingNextIndex != nil {
                    self.secondary.volume = 1
                    self.main.volume = 0
                    self.completeCrossfade()
                } else {
                    self.next()
                }
            }
        }

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
                    self.isPlaying = false
                case .ended:
                    let optionsRaw = notification.userInfo?[
                        AVAudioSessionInterruptionOptionKey
                    ] as? UInt ?? 0
                    let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
                    if options.contains(.shouldResume) {
                        self.main.play()
                        self.isPlaying = true
                    }
                @unknown default:
                    break
                }
            }
        }
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
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]

        if let artwork = nowPlayingArtwork, artworkTrackId == track.id {
            info[MPMediaItemPropertyArtwork] = artwork
        } else if lastArtworkTrackId != track.id {
            loadArtwork(for: track)
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private var nowPlayingArtwork: MPMediaItemArtwork?
    private var artworkTrackId: String?

    private func loadArtwork(for track: PlayerTrack) {
        lastArtworkTrackId = track.id
        guard let url = track.artworkURL else { return }
        Task { [weak self] in
            guard let data = await APIClient.shared.fetchData(url),
                let image = UIImage(data: data)
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
