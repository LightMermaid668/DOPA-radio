import SwiftUI

func formatDuration(_ seconds: Int?) -> String {
    guard let seconds, seconds > 0 else { return "--:--" }
    let m = seconds / 60
    let s = seconds % 60
    return String(format: "%d:%02d", m, s)
}

func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let total = Int(seconds)
    return String(format: "%d:%02d", total / 60, total % 60)
}

/// 曲の行（ライブラリ・保存した曲・ディスカバー・検索で共用）
struct TrackRowView: View {
    let title: String
    let artist: String?
    let artworkURL: URL?
    let durationSec: Int?
    var subtitleSuffix: String? = nil
    var pinned: Bool = false
    var dimmed: Bool = false
    var isCurrent: Bool = false
    var isPlaying: Bool = false
    var trailing: AnyView? = nil

    var body: some View {
        HStack(spacing: 12) {
            artwork
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(DopaColor.accent)
                    }
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(isCurrent ? DopaColor.accent : .primary)
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if isCurrent && isPlaying {
                Image(systemName: "waveform")
                    .foregroundStyle(DopaColor.accent)
                    .symbolEffect(.variableColor.iterative)
            } else if durationSec != nil {
                Text(formatDuration(durationSec))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }

            if let trailing {
                trailing
            }
        }
        .contentShape(Rectangle())
        .opacity(dimmed ? 0.55 : 1)
    }

    private var subtitle: String {
        var parts: [String] = [artist ?? "アーティスト不明"]
        if let subtitleSuffix, !subtitleSuffix.isEmpty {
            parts.append(subtitleSuffix)
        }
        return parts.joined(separator: " ・ ")
    }

    private var artwork: some View {
        Group {
            if let artworkURL {
                AsyncImage(url: artworkURL) { image in
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
                .foregroundStyle(.tertiary)
        }
    }
}

/// 保存（ライブラリに追加/解除）ボタン
struct SaveButton: View {
    let trackId: String
    @State private var saved: Bool
    @State private var busy = false

    init(trackId: String, initialSaved: Bool) {
        self.trackId = trackId
        _saved = State(initialValue: initialSaved)
    }

    var body: some View {
        Button {
            Task { await toggle() }
        } label: {
            Image(systemName: saved ? "bookmark.fill" : "bookmark")
                .font(.system(size: 15))
                .foregroundStyle(saved ? DopaColor.accent : .secondary)
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.borderless)
        .disabled(busy)
        .accessibilityLabel(saved ? "ライブラリから外す" : "ライブラリに追加")
    }

    private func toggle() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let next = !saved
        do {
            if next {
                struct Body: Encodable { let trackId: String }
                _ = try await APIClient.shared.send(
                    "/api/saved-tracks", method: "POST", body: Body(trackId: trackId)
                )
            } else {
                _ = try await APIClient.shared.send(
                    "/api/saved-tracks/\(trackId)", method: "DELETE"
                )
            }
            saved = next
        } catch {
            // 失敗時は状態を変えない
        }
    }
}

/// 保存した曲のピン留めトグル
struct SavedPinButton: View {
    let trackId: String
    let pinned: Bool
    let onChange: () -> Void

    var body: some View {
        Button {
            Task {
                struct Body: Encodable { let pinned: Bool }
                _ = try? await APIClient.shared.send(
                    "/api/saved-tracks/\(trackId)", method: "PATCH", body: Body(pinned: !pinned)
                )
                onChange()
            }
        } label: {
            Image(systemName: pinned ? "pin.fill" : "pin")
                .font(.system(size: 14))
                .foregroundStyle(pinned ? DopaColor.accent : .secondary)
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(pinned ? "ピン留めを解除" : "ピン留めする")
    }
}
