import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var player: PlayerEngine

    @State private var tracks: [TrackDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && tracks.isEmpty {
                    ProgressView("読み込み中…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, tracks.isEmpty {
                    ContentUnavailableView {
                        Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再試行") { Task { await load() } }
                    }
                } else if tracks.isEmpty {
                    ContentUnavailableView(
                        "まだ曲がありません",
                        systemImage: "music.note",
                        description: Text("Webアプリから曲をアップロードしよう")
                    )
                } else {
                    list
                }
            }
            .background(DopaColor.background)
            .navigationTitle("ライブラリ")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        player.crossfadeEnabled.toggle()
                    } label: {
                        Image(systemName: player.crossfadeEnabled
                            ? "arrow.triangle.merge" : "arrow.triangle.branch")
                    }
                    .accessibilityLabel("クロスフェード")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let user = auth.user {
                            Section(user.email) {
                                Button("ログアウト", role: .destructive) {
                                    Task { await auth.signOut() }
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("アカウント")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var list: some View {
        List {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { position, track in
                Button {
                    playFrom(track)
                } label: {
                    TrackRow(track: track)
                }
                .buttonStyle(.plain)
                .listRowBackground(DopaColor.background)
                .listRowSeparatorTint(DopaColor.border)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func playFrom(_ track: TrackDTO) {
        let ready = tracks.filter { $0.isReady }
        guard let startIndex = ready.firstIndex(where: { $0.id == track.id }) else { return }
        player.play(tracks: ready.map { $0.toPlayerTrack }, startAt: startIndex)
    }

    private func load() async {
        errorMessage = nil
        do {
            let response = try await APIClient.shared.get("/api/tracks", as: TracksResponse.self)
            tracks = response.tracks
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct TrackRow: View {
    let track: TrackDTO
    @EnvironmentObject private var player: PlayerEngine

    private var isCurrent: Bool { player.currentTrack?.id == track.id }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                if let url = track.artworkURL {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        artworkPlaceholder
                    }
                } else {
                    artworkPlaceholder
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if track.pinnedAt != nil {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(DopaColor.accent)
                    }
                    Text(track.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(isCurrent ? DopaColor.accent : .primary)
                }
                Text(track.artist ?? "アーティスト不明")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if !track.isReady {
                Text(track.status == "processing" ? "変換中" : "失敗")
                    .font(.caption2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DopaColor.card, in: Capsule())
                    .foregroundStyle(.secondary)
            } else if isCurrent && player.isPlaying {
                Image(systemName: "waveform")
                    .foregroundStyle(DopaColor.accent)
                    .symbolEffect(.variableColor.iterative)
            } else {
                Text(formatDuration(track.durationSec))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
        .contentShape(Rectangle())
        .opacity(track.isReady ? 1 : 0.55)
    }

    private var artworkPlaceholder: some View {
        ZStack {
            DopaColor.card
            Image(systemName: "music.note")
                .foregroundStyle(.tertiary)
        }
    }
}

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
