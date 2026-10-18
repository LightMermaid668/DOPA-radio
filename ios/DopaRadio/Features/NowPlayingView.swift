import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var player: PlayerEngine
    @ObservedObject private var settings = AudioSettingsStore.shared

    @State private var isSeeking = false
    @State private var seekValue: Double = 0
    @State private var showStudio = false
    @State private var showSpeedPitch = false
    @State private var showQueue = false
    @State private var showSleepTimer = false
    @State private var sleepTimerEndsAt: Date?
    @State private var sleepTimerTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            DopaColor.background.ignoresSafeArea()

            // アートワークのブラー背景（Apple Music風）
            CachedArtwork(url: player.currentTrack?.artworkURL) {
                Color.clear
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .blur(radius: 60)
            .opacity(0.3)
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.6), value: player.currentTrack?.id)

            if let track = player.currentTrack {
                VStack(spacing: 0) {
                    Spacer(minLength: 16)

                    Button {
                        player.togglePlay()
                    } label: {
                        artwork(track)
                            .frame(maxWidth: 320, maxHeight: 320)
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
                            .scaleEffect(player.isPlaying ? 1.0 : 0.92)
                            .animation(.spring(duration: 0.5), value: player.isPlaying)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(player.isPlaying ? "一時停止" : "再生")

                    VStack(spacing: 6) {
                        Text(track.title)
                            .font(.title3.weight(.bold))
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                        Text(track.artist ?? "アーティスト不明")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        if player.isCrossfading {
                            Label("次の曲にミックス中…", systemImage: "arrow.triangle.merge")
                                .font(.caption2)
                                .foregroundStyle(DopaColor.accent)
                                .padding(.top, 2)
                        } else if let notice = player.notice {
                            Text(notice)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .padding(.top, 2)
                        } else if let error = player.playbackError {
                            Text(error)
                                .font(.caption2)
                                .foregroundStyle(.red)
                                .padding(.top, 2)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)

                    Spacer(minLength: 12)

                    VStack(spacing: 6) {
                        Slider(
                            value: Binding(
                                get: { isSeeking ? seekValue : player.progress },
                                set: { seekValue = $0 }
                            ),
                            in: 0...max(player.duration, 1),
                            onEditingChanged: { editing in
                                if editing {
                                    isSeeking = true
                                    seekValue = player.progress
                                } else {
                                    player.seek(to: seekValue)
                                    isSeeking = false
                                }
                            }
                        )
                        .tint(DopaColor.accent)

                        HStack {
                            Text(formatTime(isSeeking ? seekValue : player.progress))
                            Spacer()
                            Text(formatTime(player.duration))
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    }
                    .padding(.horizontal, 32)

                    controls
                        .padding(.top, 10)

                    bottomBar
                        .padding(.horizontal, 32)
                        .padding(.top, 26)

                    Spacer(minLength: 24)
                }
            } else {
                ContentUnavailableView("再生中の曲はありません", systemImage: "music.note")
            }
        }
        .sheet(isPresented: $showStudio) {
            StudioSheet()
        }
        .sheet(isPresented: $showSpeedPitch) {
            SpeedPitchSheet()
        }
        .sheet(isPresented: $showQueue) {
            QueueSheet()
                .environmentObject(player)
        }
        .confirmationDialog(
            "おやすみタイマー",
            isPresented: $showSleepTimer,
            titleVisibility: .visible
        ) {
            Button("15分後に停止") { setSleepTimer(minutes: 15) }
            Button("30分後に停止") { setSleepTimer(minutes: 30) }
            Button("60分後に停止") { setSleepTimer(minutes: 60) }
            if sleepTimerEndsAt != nil {
                Button("タイマーをオフ", role: .destructive) { setSleepTimer(minutes: nil) }
            }
            Button("キャンセル", role: .cancel) {}
        }
    }

    private func artwork(_ track: PlayerTrack) -> some View {
        CachedArtwork(url: track.artworkURL) {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            DopaColor.card
            Image(systemName: "music.note")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
        }
    }

    private var controls: some View {
        HStack(spacing: 36) {
            Button {
                player.previous()
            } label: {
                Image(systemName: "backward.fill").font(.system(size: 28))
            }
            .accessibilityLabel("前へ")

            Button {
                player.togglePlay()
            } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(DopaColor.accent)
            }
            .accessibilityLabel(player.isPlaying ? "一時停止" : "再生")

            Button {
                player.next()
            } label: {
                Image(systemName: "forward.fill").font(.system(size: 28))
            }
            .accessibilityLabel("次へ")
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 6) {
                ModeChip(
                    label: "クロスフェード", systemImage: "arrow.triangle.merge",
                    isOn: $player.crossfadeEnabled
                )
                ModeChip(label: "サビだけ", systemImage: "scissors", isOn: $player.chorusOnly)
                ModeChip(label: "ドパ", systemImage: "radio", isOn: $player.dopaMode)
                ModeChip(label: "DJ", systemImage: "waveform.path", isOn: $settings.djMix)
            }

            HStack(spacing: 10) {
                smallButton("スタジオ", systemImage: "slider.horizontal.3") {
                    showStudio = true
                }
                smallButton("速度・ピッチ", systemImage: "gauge.with.dots.needle.33percent") {
                    showSpeedPitch = true
                }
                iconButton("list.bullet", label: "再生キュー") {
                    showQueue = true
                }
                iconButton("moon.zzz", label: "おやすみタイマー") {
                    showSleepTimer = true
                }
                AirPlayButton()
                    .frame(width: 34, height: 34)
                    .accessibilityLabel("AirPlay")
            }

            if let endsAt = sleepTimerEndsAt {
                Text("おやすみタイマー: \(endsAt.formatted(date: .omitted, time: .shortened)) に停止")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func iconButton(
        _ systemImage: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 13))
                .frame(width: 34, height: 34)
                .background(DopaColor.card, in: Circle())
                .overlay(Circle().stroke(DopaColor.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func setSleepTimer(minutes: Int?) {
        sleepTimerTask?.cancel()
        sleepTimerTask = nil
        guard let minutes else {
            sleepTimerEndsAt = nil
            return
        }
        Haptics.selection()
        let endsAt = Date().addingTimeInterval(Double(minutes) * 60)
        sleepTimerEndsAt = endsAt
        sleepTimerTask = Task { [weak player] in
            try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
            if Task.isCancelled { return }
            await MainActor.run {
                player?.pause()
            }
        }
    }

    private func smallButton(
        _ label: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.system(size: 12))
                Text(label).font(.caption2.weight(.semibold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(DopaColor.card, in: Capsule())
            .overlay(Capsule().stroke(DopaColor.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
