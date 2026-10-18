import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var player: PlayerEngine
    @Environment(\.dismiss) private var dismiss

    @State private var isSeeking = false
    @State private var seekValue: Double = 0

    var body: some View {
        ZStack {
            DopaColor.background.ignoresSafeArea()

            if let track = player.currentTrack {
                VStack(spacing: 0) {
                    // グラバー
                    Capsule()
                        .fill(DopaColor.border)
                        .frame(width: 40, height: 5)
                        .padding(.top, 12)

                    Spacer(minLength: 24)

                    artwork(track)
                        .frame(maxWidth: 320, maxHeight: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
                        .scaleEffect(player.isPlaying ? 1.0 : 0.92)
                        .animation(.spring(duration: 0.5), value: player.isPlaying)

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
    }

    private func artwork(_ track: PlayerTrack) -> some View {
        Group {
            if let url = track.artworkURL {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    placeholder
                }
            } else {
                placeholder
            }
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
        HStack {
            Toggle(isOn: $player.crossfadeEnabled) {
                Label("クロスフェード", systemImage: "arrow.triangle.merge")
                    .font(.footnote)
            }
            .toggleStyle(.switch)
            .tint(DopaColor.accent)

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("閉じる")
        }
    }
}
