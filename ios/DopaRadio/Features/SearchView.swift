import SwiftUI

/// 検索: ライブラリ / ディスカバー を切り替えて検索
struct SearchView: View {
    @EnvironmentObject private var player: PlayerEngine

    @State private var query = ""
    @State private var scope = "library"
    @State private var results: SearchResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("検索範囲", selection: $scope) {
                    Text("ライブラリ").tag("library")
                    Text("ディスカバー").tag("discover")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)

                content
            }
            .background(DopaColor.background)
            .navigationTitle("検索")
            .searchable(text: $query, prompt: "曲名・アーティスト・プレイリスト名")
            .task(id: "\(scope)|\(query)") {
                await search()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && results == nil {
            ProgressView("検索中…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            ContentUnavailableView {
                Label("検索できませんでした", systemImage: "wifi.exclamationmark")
            } description: {
                Text(errorMessage)
            }
        } else if let results {
            let tracks = results.tracks ?? []
            let playlists = results.playlists ?? []
            if tracks.isEmpty && playlists.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                List {
                    if !tracks.isEmpty {
                        Section("曲（\(tracks.count)）") {
                            ForEach(tracks) { track in
                                trackRow(track, list: tracks)
                            }
                        }
                    }
                    if !playlists.isEmpty {
                        Section("プレイリスト（\(playlists.count)）") {
                            ForEach(playlists) { playlist in
                                NavigationLink {
                                    if playlist.own {
                                        PlaylistDetailView(source: .own(id: playlist.id))
                                    } else {
                                        PlaylistDetailView(source: .publicPlaylist(id: playlist.id))
                                    }
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
                                                "\(playlist.ownerName.map { "\($0)さん" } ?? "自分のプレイリスト") ・ \(playlist.itemCount)曲"
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
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 34))
                    .foregroundStyle(.tertiary)
                Text(scope == "library"
                    ? "自分の曲・保存した曲・自分のプレイリスト"
                    : "公開されている曲・公開プレイリスト")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func trackRow(_ track: SearchTrackDTO, list: [SearchTrackDTO]) -> some View {
        Button {
            playTrack(track, list: list)
        } label: {
            TrackRowView(
                title: track.title,
                artist: track.artist,
                artworkURL: track.artworkURL,
                durationSec: track.durationSec,
                subtitleSuffix: track.ownerName.map { "\($0)さん" },
                dimmed: !track.ready,
                isCurrent: player.currentTrack?.id == track.id,
                isPlaying: player.isPlaying,
                trailing: track.own
                    ? nil
                    : AnyView(SaveButton(trackId: track.id, initialSaved: track.saved))
            )
        }
        .buttonStyle(.plain)
        .disabled(!track.ready)
        .listRowBackground(DopaColor.background)
        .listRowSeparatorTint(DopaColor.border)
    }

    private func playTrack(_ track: SearchTrackDTO, list: [SearchTrackDTO]) {
        let playable = list.filter { $0.ready }
        guard let index = playable.firstIndex(where: { $0.id == track.id }) else { return }
        player.play(tracks: playable.map { $0.toPlayerTrack }, startAt: index)
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if term.isEmpty {
            results = nil
            errorMessage = nil
            isLoading = false
            return
        }
        // デバウンス
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }

        isLoading = true
        errorMessage = nil
        do {
            let encoded =
                term.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? term
            let response = try await APIClient.shared.get(
                "/api/search?q=\(encoded)&scope=\(scope)", as: SearchResponse.self
            )
            if !Task.isCancelled {
                results = response
            }
        } catch {
            if !Task.isCancelled {
                errorMessage = error.localizedDescription
                results = nil
            }
        }
        isLoading = false
    }
}
