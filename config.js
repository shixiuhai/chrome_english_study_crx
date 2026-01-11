// API配置文件
// 配置对象
const configData = {
  // API基础URL
  API_BASE_URL: 'https://chrome.yizhiweb.top',
  
  // API端点
  ENDPOINTS: {
    TRANSLATE: '/wx/chrome/crx/translate',
    PHONETICS: '/wx/chrome/crx/phonetics',
    SYNC_UPLOAD: '/wx/chrome/crx/sync/upload',
    SYNC_DOWNLOAD: '/wx/chrome/crx/sync/download',
    SYNC_DELETE: '/wx/chrome/crx/sync/delete'
  },
  
  // API请求配置
  REQUEST_CONFIG: {
    TIMEOUT: 2000, // 2秒超时
    MAX_RETRIES: 3 // 最大重试次数
  },
  
  // 单词数量限制
  WORD_COUNT_LIMIT: 99, // 单次选中单词数量限制
  MAX_MARKED_WORDS: 8000, // 最大标记单词数量
  MAX_TEXT_NODES: 2000, // 最大处理文本节点数量
  
  // 样式配置
  STYLES: {
    MARK_COLOR: '#1e90ff',
    MARK_UNDERLINE_WIDTH: '2px',
    TOOLTIP_DELAY: 300
  },
  
  // 存储键名
  STORAGE_KEYS: {
    DICTIONARY: 'word_dictionary',
    MARKS: 'word_marks',
    EXCLUDED_DOMAINS: 'excluded_domains'
  },
  
  // TTS配置
  TTS_RATE: 0.9,
  TTS_LANG: 'en-US'
};

// 导出配置对象
if (typeof module !== 'undefined' && module.exports) {
  // Node.js环境
  module.exports = configData;
} else if (typeof window !== 'undefined') {
  // 浏览器环境（content script等）
  window.CONFIG = configData;
} else {
  // Service Worker环境
  self.CONFIG = configData;
}