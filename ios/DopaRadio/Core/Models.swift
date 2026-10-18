import Foundation

// MARK: - サーバーレスポンス

struct DopaUser: Codable, Identifiable {
    let id: String
    let name: String
    let email: String
    let image: String?
}

struct SessionResponse: Codable {
    struct SessionInfo: Codable {
        let id: String
        let expiresAt: String?
    }
    let session: SessionInfo?
    let user: DopaUser?
}

struct ErrorBody: Codable {
    let message: String?
    let error: String?
}

struct TracksResponse: Codable {
    let tracks: [TrackDTO]
}

struct TrackDTO: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String?
    let album: String?
    let durationSec: Int?
    let status: String?
    let pinnedAt: String?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    let hasArtwork: Bool?
    let own: Bool?
    let ownerName: String?

    var isReady: Bool { (status ?? "ready") == "ready" }

    var artworkURL: URL? {
        guard hasArtwork ?? true else { return nil }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/artwork")
    }

    var toPlayerTrack: PlayerTrack {
        PlayerTrack(
            id: id,
            title: title,
            artist: artist,
            durationSec: durationSec,
            artworkURL: artworkURL,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec,
            localURL: DownloadStore.shared.localURL(for: id)
        )
    }
}

// MARK: - プレイヤー用トラック

struct PlayerTrack: Identifiable, Equatable {
    let id: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let artworkURL: URL?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    var localURL: URL?
    var directURL: URL?

    var streamURL: URL? {
        if let localURL { return localURL }
        if let directURL { return directURL }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/file")
    }
}

// MARK: - プレイリスト

struct PlaylistsResponse: Codable {
    let playlists: [PlaylistSummaryDTO]
}

struct PlaylistSummaryDTO: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let visibility: String?
    let itemCount: Int?
}

struct ExternalMetaDTO: Codable {
    let title: String?
    let artist: String?
    let artworkUrl: String?
    let deepLink: String?
    let previewUrl: String?
    let durationMs: Int?
}

struct OwnPlaylistResponse: Codable {
    let playlist: OwnPlaylistDTO?
    let items: [OwnPlaylistItemDTO]
}

struct OwnPlaylistDTO: Codable {
    let id: String
    let title: String
    let description: String?
    let visibility: String?
    let ownerId: String
}

struct OwnPlaylistItemDTO: Codable, Identifiable {
    let id: String
    let kind: String
    let trackId: String?
    let externalMeta: ExternalMetaDTO?
    let title: String?
    let artist: String?
    let durationSec: Int?
    let status: String?
    let artworkKey: String?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
}

struct PublicPlaylistResponse: Codable {
    let playlist: PublicPlaylistDTO?
    let items: [PublicPlaylistItemDTO]
}

struct PublicPlaylistDTO: Codable {
    let id: String
    let title: String
    let description: String?
    let ownerId: String?
    let ownerName: String?
    let own: Bool?
}

struct PublicPlaylistItemDTO: Codable, Identifiable {
    let itemId: String
    let kind: String
    let trackId: String?
    let ownerId: String?
    let status: String?
    let hasArtwork: Bool?
    let title: String?
    let artist: String?
    let durationSec: Int?
    let artworkUrl: String?
    let deepLink: String?
    let previewUrl: String?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    let saved: Bool?

    var id: String { itemId }
}

// MARK: - プレイリスト表示用の統合モデル

struct PlaylistDisplay {
    let id: String
    let title: String
    let description: String?
    let ownerName: String?
    let isOwn: Bool
    let items: [PlaylistDisplayItem]
}

struct PlaylistDisplayItem: Identifiable {
    let itemId: String
    let kind: String
    let trackId: String?
    let title: String
    let artist: String?
    let durationSec: Int?
    let status: String?
    let hasArtwork: Bool
    let externalArtworkURL: URL?
    let deepLink: URL?
    let previewURL: URL?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    var saved: Bool

    var id: String { itemId }

    var isPlayableUpload: Bool {
        kind == "upload" && (status ?? "ready") == "ready" && trackId != nil
    }

    var artworkURL: URL? {
        if kind == "upload" {
            guard hasArtwork, let trackId else { return nil }
            return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(trackId)/artwork")
        }
        return externalArtworkURL
    }

    var toPlayerTrack: PlayerTrack? {
        if isPlayableUpload, let trackId {
            return PlayerTrack(
                id: trackId,
                title: title,
                artist: artist,
                durationSec: durationSec,
                artworkURL: artworkURL,
                chorusStartSec: chorusStartSec,
                chorusEndSec: chorusEndSec,
                localURL: DownloadStore.shared.localURL(for: trackId),
                directURL: nil
            )
        }
        if kind != "upload", let previewURL {
            return PlayerTrack(
                id: "\(kind):\(itemId)",
                title: title,
                artist: artist,
                durationSec: durationSec,
                artworkURL: externalArtworkURL,
                chorusStartSec: nil,
                chorusEndSec: nil,
                localURL: nil,
                directURL: previewURL
            )
        }
        return nil
    }
}

// MARK: - ディスカバー

struct DiscoverResponse: Codable {
    let tracks: [DiscoverTrackDTO]
    let playlists: [DiscoverPlaylistDTO]
}

struct DiscoverTrackDTO: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let hasArtwork: Bool
    let ownerName: String?
    let playCount: Int?
    let saved: Bool
    let own: Bool
    let chorusStartSec: Int?
    let chorusEndSec: Int?

    var artworkURL: URL? {
        guard hasArtwork else { return nil }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/artwork")
    }

    var toPlayerTrack: PlayerTrack {
        PlayerTrack(
            id: id,
            title: title,
            artist: artist,
            durationSec: durationSec,
            artworkURL: artworkURL,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec,
            localURL: DownloadStore.shared.localURL(for: id),
            directURL: nil
        )
    }
}

struct DiscoverPlaylistDTO: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let ownerName: String?
    let itemCount: Int
}

// MARK: - 保存した曲

struct SavedTracksResponse: Codable {
    let tracks: [SavedTrackDTO]
}

struct SavedTrackDTO: Codable, Identifiable {
    let trackId: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let hasArtwork: Bool
    let ready: Bool
    let ownerName: String?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    let pinned: Bool

    var id: String { trackId }

    var artworkURL: URL? {
        guard hasArtwork else { return nil }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(trackId)/artwork")
    }

    var toPlayerTrack: PlayerTrack {
        PlayerTrack(
            id: trackId,
            title: title,
            artist: artist,
            durationSec: durationSec,
            artworkURL: artworkURL,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec,
            localURL: DownloadStore.shared.localURL(for: id),
            directURL: nil
        )
    }
}

// MARK: - 検索

struct SearchResponse: Codable {
    let tracks: [SearchTrackDTO]?
    let playlists: [SearchPlaylistDTO]?
}

struct SearchTrackDTO: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let hasArtwork: Bool
    let ready: Bool
    let ownerName: String?
    let own: Bool
    let saved: Bool
    let chorusStartSec: Int?
    let chorusEndSec: Int?

    var artworkURL: URL? {
        guard hasArtwork else { return nil }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/artwork")
    }

    var toPlayerTrack: PlayerTrack {
        PlayerTrack(
            id: id,
            title: title,
            artist: artist,
            durationSec: durationSec,
            artworkURL: artworkURL,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec,
            localURL: DownloadStore.shared.localURL(for: id),
            directURL: nil
        )
    }
}

struct SearchPlaylistDTO: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let ownerName: String?
    let itemCount: Int
    let own: Bool
}

// MARK: - ドパモード（ラジオ）

struct RadioNextResponse: Codable {
    let tracks: [RadioTrackDTO]
}

struct RadioTrackDTO: Codable, Identifiable {
    let id: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let hasArtwork: Bool
    let chorusStartSec: Int?
    let chorusEndSec: Int?

    var toPlayerTrack: PlayerTrack {
        PlayerTrack(
            id: id,
            title: title,
            artist: artist,
            durationSec: durationSec,
            artworkURL: hasArtwork
                ? URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/artwork")
                : nil,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec,
            localURL: DownloadStore.shared.localURL(for: id),
            directURL: nil
        )
    }
}
