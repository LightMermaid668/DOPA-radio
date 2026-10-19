import SwiftUI

/// プレイリスト詳細（自分のプレイリスト / 公開プレイリスト共通）
struct PlaylistDetailView: View {
    enum Source {
        case own(id: String)
        case publicPlaylist(id: String)
    }

    let source: Source

    @EnvironmentObject private var player: PlayerEngine
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @ObservedObject private var downloads = DownloadStore.shared

    @State private var display: PlaylistDisplay?
    @State private var errorMessage: String?
    @State private var isBusy = false
    @State private var showDeleteConfirm = false

    var body: some View {
        Group {
            if let display {
                content(display)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("読み込めませんでした", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("再試行") { Task { await load() } }
                }
            } else {
                ProgressView("読み込み中…")
            }
        }
        .background(DopaColor.background)
        .navigationTitle(display?.title ?? "プレイリスト")
        .dopaInlineTitle()
        .toolbar {
            if let display, display.isOwn {
                ToolbarItem(placement: .dopaTrailing) {
                    Menu {
                        Button("プレイリストを削除", role: .destructive) {
                            showDeleteConfirm = true
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .confirmationDialog(
            "このプレイリストを削除しますか？",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("削除", role: .destructive) { Task { await deletePlaylist() } }
            Button("キャンセル", role: .cancel) {}
        }
        .task { await load() }
    }

    private func content(_ display: PlaylistDisplay) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    if let description = display.description, !description.isEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text(ownerLabel(display))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button {
                            playFrom(itemId: nil)
                        } label: {
                            Label("全曲再生", systemImage: "play.fill")
                                .font(.footnote.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(DopaColor.accent)
                        .foregroundStyle(.black)
                        .disabled(playableItems(display).isEmpty)
                    }

                    playlistDownloadRow(display)
                }
                .listRowBackground(DopaColor.background)
            }

            Section {
                if display.items.isEmpty {
                    Text("曲がありません")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(display.items.enumerated()), id: \.element.id) { position, item in
                        itemRow(item, position: position + 1, isOwn: display.isOwn)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func ownerLabel(_ display: PlaylistDisplay) -> String {
        if display.isOwn {
            return "\(display.items.count)曲 ・ 自分のプレイリスト"
        }
        return "\(display.items.count)曲 ・ \(display.ownerName ?? "メンバー")さん"
    }

    // MARK: - プレイリストのダウンロード

    private func downloadableItems(_ display: PlaylistDisplay) -> [PlaylistDisplayItem] {
        display.items.filter { $0.isPlayableUpload }
    }

    private func downloadFraction(_ display: PlaylistDisplay) -> Double {
        let items = downloadableItems(display)
        guard !items.isEmpty else { return 0 }
        let total = items.reduce(0.0) { sum, item in
            guard let trackId = item.trackId else { return sum }
            if downloads.isDownloaded(trackId) { return sum + 1 }
            return sum + (downloads.progress[trackId] ?? 0)
        }
        return total / Double(items.count)
    }

    @ViewBuilder
    private func playlistDownloadRow(_ display: PlaylistDisplay) -> some View {
        let items = downloadableItems(display)
        let downloaded = items.filter { item in
            guard let trackId = item.trackId else { return false }
            return downloads.isDownloaded(trackId)
        }.count
        let downloading = items.contains { item in
            guard let trackId = item.trackId else { return false }
            return downloads.isDownloading(trackId)
        }

        if !items.isEmpty {
            let failed = items.filter { item in
                guard let trackId = item.trackId else { return false }
                return downloads.failedTrackIds.contains(trackId)
            }.count

            HStack(spacing: 10) {
                if downloading {
                    ProgressView(value: downloadFraction(display))
                        .frame(width: 90)
                    Text("保存中… \(downloaded)/\(items.count)曲")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if downloaded == items.count {
                    Button(role: .destructive) {
                        deletePlaylistDownloads(display)
                    } label: {
                        Label("ダウンロードを削除", systemImage: "trash")
                            .font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    Text("オフライン保存済み")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Button {
                        downloadPlaylist(display)
                    } label: {
                        Label(
                            failed > 0 ? "再試行" : "プレイリストをダウンロード",
                            systemImage: "arrow.down.circle"
                        )
                        .font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    Text(
                        failed > 0
                            ? "\(downloaded)/\(items.count)曲 ・ \(failed)曲失敗"
                            : "\(downloaded)/\(items.count)曲"
                    )
                    .font(.caption2)
                    .foregroundStyle(failed > 0 ? .orange : .secondary)
                }
                Spacer()
            }
            .padding(.top, 2)
        }
    }

    private func downloadPlaylist(_ display: PlaylistDisplay) {
        Haptics.tap()
        for item in downloadableItems(display) {
            guard let trackId = item.trackId,
                !downloads.isDownloaded(trackId),
                !downloads.isDownloading(trackId)
            else { continue }
            downloads.download(
                trackId: trackId,
                title: item.title,
                artist: item.artist,
                durationSec: item.durationSec,
                chorusStartSec: item.chorusStartSec,
                chorusEndSec: item.chorusEndSec
            )
        }
    }

    private func deletePlaylistDownloads(_ display: PlaylistDisplay) {
        Haptics.tap()
        for item in downloadableItems(display) {
            guard let trackId = item.trackId else { continue }
            downloads.delete(trackId)
        }
    }

    @ViewBuilder
    private func itemRow(_ item: PlaylistDisplayItem, position: Int, isOwn: Bool) -> some View {
        HStack(spacing: 10) {
            Text("\(position)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(width: 18, alignment: .trailing)

            Button {
                if item.isPlayableUpload || item.previewURL != nil {
                    playFrom(itemId: item.itemId)
                } else if let deepLink = item.deepLink {
                    openURL(deepLink)
                }
            } label: {
                TrackRowView(
                    title: item.title,
                    artist: item.artist,
                    artworkURL: item.artworkURL,
                    durationSec: item.durationSec,
                    dimmed: item.kind == "upload" && !item.isPlayableUpload,
                    isCurrent: player.currentTrack?.id == (item.trackId ?? "\(item.kind):\(item.itemId)"),
                    isPlaying: player.isPlaying,
                    trailing: trailingView(for: item, isOwn: isOwn)
                )
            }
            .buttonStyle(.plain)
        }
        .listRowBackground(DopaColor.background)
        .listRowSeparatorTint(DopaColor.border)
        .contextMenu {
            if item.isPlayableUpload, let trackId = item.trackId {
                if downloads.isDownloaded(trackId) {
                    Button(role: .destructive) {
                        downloads.delete(trackId)
                    } label: {
                        Label("ダウンロードを削除", systemImage: "trash")
                    }
                } else if !downloads.isDownloading(trackId) {
                    Button {
                        downloads.download(
                            trackId: trackId,
                            title: item.title,
                            artist: item.artist,
                            durationSec: item.durationSec,
                            chorusStartSec: item.chorusStartSec,
                            chorusEndSec: item.chorusEndSec
                        )
                    } label: {
                        Label("ダウンロード", systemImage: "arrow.down.circle")
                    }
                }
            }
        }
    }

    private func trailingView(for item: PlaylistDisplayItem, isOwn: Bool) -> AnyView? {
        if item.kind != "upload" {
            return AnyView(
                Image(systemName: "arrow.up.forward.app")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
            )
        }
        if item.kind == "upload", !item.isPlayableUpload {
            return AnyView(
                Text(item.status == "processing" ? "変換中" : "不可")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            )
        }
        if isOwn, let trackId = item.trackId, item.saved {
            return AnyView(
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(DopaColor.accent)
                    .frame(width: 34, height: 34)
            )
        }
        if !isOwn, let trackId = item.trackId {
            return AnyView(SaveButton(trackId: trackId, initialSaved: item.saved))
        }
        return nil
    }

    private func playableItems(_ display: PlaylistDisplay) -> [PlaylistDisplayItem] {
        display.items.filter { $0.toPlayerTrack != nil }
    }

    private func playFrom(itemId: String?) {
        guard let display else { return }
        let playable = playableItems(display)
        guard !playable.isEmpty else { return }
        let index = itemId.flatMap { id in
            playable.firstIndex(where: { $0.itemId == id })
        } ?? 0
        player.play(tracks: playable.compactMap { $0.toPlayerTrack }, startAt: index)
    }

    // MARK: - データ

    private func load() async {
        errorMessage = nil
        do {
            switch source {
            case .own(let id):
                let response = try await APIClient.shared.get(
                    "/api/playlists/\(id)", as: OwnPlaylistResponse.self
                )
                display = mapOwn(response)
            case .publicPlaylist(let id):
                let response = try await APIClient.shared.get(
                    "/api/public/playlists/\(id)", as: PublicPlaylistResponse.self
                )
                display = mapPublic(response)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func mapOwn(_ response: OwnPlaylistResponse) -> PlaylistDisplay {
        let items = response.items.map { item -> PlaylistDisplayItem in
            let external = item.externalMeta
            return PlaylistDisplayItem(
                itemId: item.id,
                kind: item.kind,
                trackId: item.trackId,
                title: item.title ?? external?.title ?? "不明なトラック",
                artist: item.artist ?? external?.artist,
                durationSec: item.durationSec
                    ?? external?.durationMs.map { Int(round(Double($0) / 1000)) },
                status: item.status,
                hasArtwork: item.artworkKey != nil,
                externalArtworkURL: external?.artworkUrl.flatMap { URL(string: $0) },
                deepLink: external?.deepLink.flatMap { URL(string: $0) },
                previewURL: external?.previewUrl.flatMap { URL(string: $0) },
                chorusStartSec: item.chorusStartSec,
                chorusEndSec: item.chorusEndSec,
                saved: false
            )
        }
        return PlaylistDisplay(
            id: response.playlist?.id ?? "",
            title: response.playlist?.title ?? "プレイリスト",
            description: response.playlist?.description,
            ownerName: nil,
            isOwn: true,
            items: items
        )
    }

    private func mapPublic(_ response: PublicPlaylistResponse) -> PlaylistDisplay {
        let items = response.items.map { item in
            PlaylistDisplayItem(
                itemId: item.itemId,
                kind: item.kind,
                trackId: item.trackId,
                title: item.title ?? "不明なトラック",
                artist: item.artist,
                durationSec: item.durationSec,
                status: item.status,
                hasArtwork: item.hasArtwork ?? false,
                externalArtworkURL: item.artworkUrl.flatMap { URL(string: $0) },
                deepLink: item.deepLink.flatMap { URL(string: $0) },
                previewURL: item.previewUrl.flatMap { URL(string: $0) },
                chorusStartSec: item.chorusStartSec,
                chorusEndSec: item.chorusEndSec,
                saved: item.saved ?? false
            )
        }
        return PlaylistDisplay(
            id: response.playlist?.id ?? "",
            title: response.playlist?.title ?? "プレイリスト",
            description: response.playlist?.description,
            ownerName: response.playlist?.ownerName,
            isOwn: response.playlist?.own ?? false,
            items: items
        )
    }

    private func deletePlaylist() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        guard case .own(let id) = source else { return }
        _ = try? await APIClient.shared.send("/api/playlists/\(id)", method: "DELETE")
        dismiss()
    }
}
