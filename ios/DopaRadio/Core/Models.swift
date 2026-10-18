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
    let own: Bool?
    let ownerName: String?

    var isReady: Bool { (status ?? "ready") == "ready" }

    var artworkURL: URL? {
        URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/artwork")
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
            localURL: nil
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

    var streamURL: URL? {
        if let localURL { return localURL }
        return URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(id)/file")
    }
}
