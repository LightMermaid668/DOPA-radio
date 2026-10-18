import SwiftUI
import UIKit

/// アートワーク画像のキャッシュ（スクロールや画面遷移のたびに再取得しない）
final class ArtworkCache {
    static let shared = ArtworkCache()

    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 200
    }

    func image(for url: URL) async -> UIImage? {
        let key = url.absoluteString as NSString
        if let cached = cache.object(forKey: key) {
            return cached
        }
        guard let data = await APIClient.shared.fetchData(url),
            let image = UIImage(data: data)
        else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// AsyncImageのキャッシュ版
struct CachedArtwork<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            image = nil
            guard let url else { return }
            image = await ArtworkCache.shared.image(for: url)
        }
    }
}
