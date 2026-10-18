import SwiftUI

/// ホーム: ピン留め（自分の曲＋保存した曲）と保存した曲一覧
struct HomeView: View {
    @EnvironmentObject private var player: PlayerEngine

    @State private var savedTracks: [SavedTrackDTO] = []
    @State private var ownTracks: [TrackDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private struct PinnedCard: Identifiable {
        let id: String
        let title: String
        let artist: String?
        let artworkURL: URL?
        let saved: Bool
        let playerTrack: PlayerTrack
    }

    private var pinnedCards: [PinnedCard] {
        var cards: [PinnedCard] = []
        for track in ownTracks where track.pinnedAt != nil && track.isReady {
            cards.append(
                PinnedCard(
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    artworkURL: track.artworkURL,
                    saved: false,
                    playerTrack: track.toPlayerTrack
                )
            )
        }
        for track in savedTracks where track.pinned && track.ready {
            cards.append(
                PinnedCard(
                    id: track.trackId,
                    title: track.title,
                    artist: track.artist,
                    artworkURL: track.artworkURL,
                    saved: true,
                    playerTrack: track.toPlayerTrack
                )
            )
        }
        return cards
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && savedTracks.isEmpty && ownTracks.isEmpty {
                    ProgressView("読み込み中…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, savedTracks.isEmpty && ownTracks.isEmpty {
                    ContentUnavailableView {
                        Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再試行") { Task { await load() } }
                    }
                } else {
                    content
                }
            }
            .background(DopaColor.background)
            .navigationTitle("ホーム")
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var content: some View {
        List {
            if !pinnedCards.isEmpty {
                Section("ピン留め") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(pinnedCards) { card in
                                pinnedCard(card)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
            }

            Section("保存した曲") {
                if savedTracks.isEmpty {
                    Text("ディスカバーや検索から「保存」するとここに追加されます")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(savedTracks.enumerated()), id: \.element.id) { position, track in
                        Button {
                            playSaved(at: position)
                        } label: {
                            TrackRowView(
                                title: track.title,
                                artist: track.artist,
                                artworkURL: track.artworkURL,
                                durationSec: track.durationSec,
                                subtitleSuffix: track.ownerName.map { "\($0)さん" },
                                pinned: track.pinned,
                                dimmed: !track.ready,
                                isCurrent: player.currentTrack?.id == track.trackId,
                                isPlaying: player.isPlaying,
                                trailing: AnyView(
                                    HStack(spacing: 0) {
                                        SavedPinButton(trackId: track.trackId, pinned: track.pinned) {
                                            Task { await load() }
                                        }
                                        Button {
                                            Task { await unsave(track.trackId) }
                                        } label: {
                                            Image(systemName: "bookmark.slash")
                                                .font(.system(size: 14))
                                                .foregroundStyle(.secondary)
                                                .frame(width: 34, height: 34)
                                        }
                                        .buttonStyle(.borderless)
                                        .accessibilityLabel("ライブラリから外す")
                                    }
                                )
                            )
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(DopaColor.background)
                        .listRowSeparatorTint(DopaColor.border)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func pinnedCard(_ card: PinnedCard) -> some View {
        Button {
            playPinned(card)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                ZStack {
                    if let url = card.artworkURL {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            cardPlaceholder
                        }
                    } else {
                        cardPlaceholder
                    }
                }
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                Text(card.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(card.artist ?? "アーティスト不明")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 104)
        }
        .buttonStyle(.plain)
    }

    private var cardPlaceholder: some View {
        ZStack {
            DopaColor.card
            Image(systemName: "music.note")
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - 再生

    private func playPinned(_ card: PinnedCard) {
        let cards = pinnedCards
        guard let index = cards.firstIndex(where: { $0.id == card.id }) else { return }
        player.play(tracks: cards.map { $0.playerTrack }, startAt: index)
    }

    private func playSaved(at position: Int) {
        let playable = savedTracks.filter { $0.ready }
        guard let current = savedTracks.indices.contains(position) ? savedTracks[position] : nil,
            let index = playable.firstIndex(where: { $0.trackId == current.trackId })
        else { return }
        player.play(tracks: playable.map { $0.toPlayerTrack }, startAt: index)
    }

    // MARK: - データ

    private func unsave(_ trackId: String) async {
        _ = try? await APIClient.shared.send("/api/saved-tracks/\(trackId)", method: "DELETE")
        await load()
    }

    private func load() async {
        errorMessage = nil
        async let saved: SavedTracksResponse? = try? await APIClient.shared.get(
            "/api/saved-tracks", as: SavedTracksResponse.self
        )
        async let own: TracksResponse? = try? await APIClient.shared.get(
            "/api/tracks", as: TracksResponse.self
        )
        let savedResult = await saved
        let ownResult = await own

        if let savedResult {
            savedTracks = savedResult.tracks
        } else if savedTracks.isEmpty {
            errorMessage = "通信に失敗しました"
        }
        if let ownResult {
            ownTracks = ownResult.tracks
        }
        isLoading = false
    }
}
