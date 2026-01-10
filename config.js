// API配置文件
const CONFIG = {
  // API基础URL
  API_BASE_URL: 'http://chrome.yizhiweb.top:8080',
  
  // API端点
  ENDPOINTS: {
    TRANSLATE: '/wx/chrome/crx/translate',
    PHONETICS: '/wx/chrome/crx/phonetics',
    SYNC_UPLOAD: '/wx/chrome/crx/sync/upload',
    SYNC_DOWNLOAD: '/wx/chrome/crx/sync/download',
    SYNC_DELETE: '/wx/chrome/crx/sync/delete'
  },
  
  // 单词数量限制
  WORD_COUNT_LIMIT: 50, // 单次选中单词数量限制
  MAX_MARKED_WORDS: 1000, // 最大标记单词数量
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
  module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}