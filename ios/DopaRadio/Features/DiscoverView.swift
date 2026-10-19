import SwiftUI

/// ディスカバー: 公開プレイリストと公開されている曲
struct DiscoverView: View {
    @EnvironmentObject private var player: PlayerEngine

    @State private var data: DiscoverResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var savedOverrides: [String: Bool] = [:]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && data == nil {
                    ProgressView("読み込み中…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, data == nil {
                    ContentUnavailableView {
                        Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再試行") { Task { await load() } }
                    }
                } else if let data {
                    content(data)
                }
            }
            .background(DopaColor.background)
            .navigationTitle("ディスカバー")
            .toolbar {
                ToolbarItem(placement: .dopaTrailing) {
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("更新")
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func content(_ data: DiscoverResponse) -> some View {
        List {
            Section("公開プレイリスト") {
                if data.playlists.isEmpty {
                    Text("まだ公開プレイリストがありません")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(data.playlists) { playlist in
                        NavigationLink {
                            PlaylistDetailView(source: .publicPlaylist(id: playlist.id))
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    DopaColor.card
                                    Image(systemName: "list.bullet.rectangle")
                                        .foregroundStyle(DopaColor.accent)
                                }
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 8))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(playlist.title)
                                        .font(.subheadline.weight(.semibold))
                                        .lineLimit(1)
                                    Text(
                                        "\(playlist.ownerName ?? "メンバー") ・ \(playlist.itemCount)曲"
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .listRowBackground(DopaColor.background)
                        .listRowSeparatorTint(DopaColor.border)
                    }
                }
            }

            Section("公開されている曲") {
                if data.tracks.isEmpty {
                    Text("まだ公開されている曲がありません")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(data.tracks) { track in
                        Button {
                            playFrom(track)
                        } label: {
                            TrackRowView(
                                title: track.title,
                                artist: track.artist,
                                artworkURL: track.artworkURL,
                                durationSec: track.durationSec,
                                subtitleSuffix: track.ownerName.map { "\($0)さん" },
                                isCurrent: player.currentTrack?.id == track.id,
                                isPlaying: player.isPlaying,
                                trailing: track.own
                                    ? nil
                                    : AnyView(
                                        SaveButton(
                                            trackId: track.id,
                                            initialSaved: savedState(
                                                id: track.id, fallback: track.saved
                                            )
                                        )
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(DopaColor.background)
                        .listRowSeparatorTint(DopaColor.border)
                        .contextMenu {
                            Button {
                                player.playNext(track.toPlayerTrack)
                            } label: {
                                Label("次に再生", systemImage: "arrow.turn.down.right")
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func savedState(id: String, fallback: Bool) -> Bool {
        savedOverrides[id] ?? fallback
    }

    private func playFrom(_ track: DiscoverTrackDTO) {
        guard let data else { return }
        let tracks = data.tracks.map { $0.toPlayerTrack }
        guard let index = data.tracks.firstIndex(where: { $0.id == track.id }) else { return }
        player.play(tracks: tracks, startAt: index)
    }

    private func load() async {
        errorMessage = nil
        do {
            data = try await APIClient.shared.get("/api/discover", as: DiscoverResponse.self)
        } catch {
            if data == nil {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}
