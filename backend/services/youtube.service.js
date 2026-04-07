import ytSearch from 'yt-search'

/**
 * Search YouTube and return the direct watch URL + metadata for the top result.
 * @param {string} query - song/video name to search
 * @returns {{ url: string, title: string, videoId: string, thumbnail: string } | null}
 */
export const getYouTubeVideoUrl = async (query) => {
  try {
    const result = await ytSearch(query)

    if (result.videos && result.videos.length > 0) {
      const video = result.videos[0]
      return {
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        title: video.title,
        videoId: video.videoId,
        thumbnail: video.thumbnail,
        author: video.author?.name || ''
      }
    }
    return null
  } catch (error) {
    console.error('YouTube service error:', error)
    return null
  }
}
