import SwiftUI

struct MiniPlayerBar: View {
    @EnvironmentObject private var player: PlayerEngine
    @Binding var showNowPlaying: Bool
    /// タブバーアクセサリ内では背景をシステムに任せる
    var embedded = false

    var body: some View {
        if let track = player.currentTrack {
            VStack(spacing: 0) {
                ProgressView(
                    value: player.duration > 0 ? player.progress / player.duration : 0
                )
                .progressViewStyle(.linear)
                .tint(DopaColor.accent)

                HStack(spacing: 12) {
                    artwork(track)
                        .frame(width: 40, height: 40)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 1) {
                        Text(track.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(track.artist ?? "アーティスト不明")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button {
                        player.togglePlay()
                    } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 20))
                            .frame(width: 36, height: 36)
                    }
                    .accessibilityLabel(player.isPlaying ? "一時停止" : "再生")

                    Button {
                        player.next()
                    } label: {
                        Image(systemName: "forward.fill")
                            .font(.system(size: 17))
                            .frame(width: 36, height: 36)
                    }
                    .accessibilityLabel("次の曲")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .background(embedded ? AnyShapeStyle(.clear) : AnyShapeStyle(.ultraThinMaterial))
            .overlay(alignment: .top) {
                if !embedded {
                    Rectangle()
                        .fill(DopaColor.border)
                        .frame(height: 0.5)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { showNowPlaying = true }
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
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}
