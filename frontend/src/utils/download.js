import axios from 'axios'

const parseFilenameFromDisposition = (contentDisposition) => {
  if (!contentDisposition) {
    return ''
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const normalMatch = contentDisposition.match(/filename="?([^"]+)"?/i)
  if (normalMatch?.[1]) {
    return normalMatch[1]
  }

  return ''
}

export const downloadDataFile = async (dataId, fallbackName = 'download') => {
  const token = localStorage.getItem('token')

  const response = await axios.get(`/api/data/${dataId}/download`, {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })

  const filename =
    parseFilenameFromDisposition(response.headers?.['content-disposition']) ||
    fallbackName

  const blob = new Blob([response.data], {
    type: response.headers?.['content-type'] || 'application/octet-stream'
  })

  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  window.URL.revokeObjectURL(url)
}
