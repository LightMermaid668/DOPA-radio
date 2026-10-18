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

    init() {
        crossfadeEnabled =
            (UserDefaults.standard.object(forKey: "dopa.crossfade") as? Bool) ?? true

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
        } else {
            main.pause()
            isPlaying = false
            progress = 0
            updateNowPlaying(force: true)
        }
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
        if position > 0 {
            main.seek(to: CMTime(seconds: position, preferredTimescale: 600))
        }
        main.play()
        isPlaying = true
        playbackError = nil
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

        // 予期せぬ停止からの復帰（割り込み等）
        if isPlaying && main.rate == 0 && item.status == .readyToPlay
            && !isCrossfading
            && progress < duration - 1
        {
            main.play()
        }

        // クロスフェード開始判定
        if isPlaying, crossfadeEnabled, pendingNextIndex == nil,
            itemDuration.isFinite, itemDuration > crossfadeSeconds + 1,
            itemDuration - progress <= crossfadeSeconds,
            hasNext
        {
            beginCrossfade()
        }

        // Now Playing は1秒に1回程度更新
        if Date().timeIntervalSince(lastNowPlayingUpdate) >= 1 {
            updateNowPlaying()
        }
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
