// Chrome插件后台脚本 - 单词学习助手

// 使用importScripts导入config.js，共享配置
importScripts('config.js');

// 获取配置对象，确保CONFIG可用
// 添加默认值作为安全保障，防止config.js加载失败或配置不完整
const CONFIG = self.CONFIG || {
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
  
  // 存储键名
  STORAGE_KEYS: {
    DICTIONARY: 'word_dictionary',
    MARKS: 'word_marks',
    EXCLUDED_DOMAINS: 'excluded_domains'
  }
};

// 清除self对象上的CONFIG，避免内存泄漏
if (self.CONFIG) {
  delete self.CONFIG;
}

// 通用API请求函数，支持自动重试
async function fetchWithRetry(url, options = {}, retryCount = CONFIG.REQUEST_CONFIG.MAX_RETRIES) {
  const defaultOptions = {
    method: 'GET',
    redirect: 'follow',
    timeout: CONFIG.REQUEST_CONFIG.TIMEOUT, // 使用配置中的超时时间
    ...options
  };

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), defaultOptions.timeout);
    
    const response = await fetch(url, {
      ...defaultOptions,
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      if (retryCount > 0 && (response.status >= 500 || response.status === 521)) {
        // 服务器错误或Cloudflare 521错误，重试
        console.log(`API请求失败(${response.status})，重试中... (剩余${retryCount}次)`);
        return fetchWithRetry(url, options, retryCount - 1);
      }
      throw new Error(`API请求失败: ${response.status}`);
    }
    
    return response;
  } catch (error) {
    if (retryCount > 0 && (error.name === 'AbortError' || error.name === 'TypeError' || error.message.includes('521'))) {
      // 超时、网络错误或521错误，重试
      console.log(`API请求异常(${error.name || error.message})，重试中... (剩余${retryCount}次)`);
      return fetchWithRetry(url, options, retryCount - 1);
    }
    throw error;
  }
}

class ExtensionBackground {
  constructor() {
    this.storageKeys = {
      words: CONFIG.STORAGE_KEYS.DICTIONARY,
      marks: CONFIG.STORAGE_KEYS.MARKS
    };
    
    this.initMessageHandlers();
  }

  initMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch(request.type) {
        case 'translate':
          this.handleTranslation(request.word, sendResponse, true);
          return true;
        
        case 'translate_no_save':
          this.handleTranslation(request.word, sendResponse, false);
          return true;
          
        case 'save_word':
          this.saveWord(request.word, request.translation)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'get_dictionary':
          this.getDictionary()
            .then(dict => sendResponse({dictionary: dict}));
          return true;
            
        case 'delete_word':
          this.deleteWord(request.word)
            .then(() => sendResponse({success: true}));
          return true;
          
        case 'delete_words':
          this.deleteWords(request.words)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'update_translation':
          this.updateTranslation(request.word, request.translation)
            .then(() => sendResponse({success: true}));
          return true;
          
        case 'update_phonetic':
          this.updatePhonetic(request.word, request.phonetic)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'update_review_count':
          this.updateReviewCount(request.word, request.isCorrect)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'save_mark':
          this.saveMark(request.markData)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'get_marks':
          this.getMarks()
            .then(marks => sendResponse({marks}));
          return true;
          
        case 'remove_mark':
          this.removeMark(request.markId)
            .then(() => sendResponse({success: true}));
          return true;
          
        case 'remove_all_marks_for_word':
          this.removeAllMarksForWord(request.word)
            .then(() => sendResponse({success: true}));
          return true;
          
        case 'get_phonetics':
          this.getPhonetics(request.word)
            .then(phonetics => sendResponse({phonetics}));
          return true;
          
        case 'save_dictionary':
          // 保存整个字典到本地存储
          chrome.storage.local.set({[this.storageKeys.words]: request.dictionary},
            () => {
              sendResponse({success: true});
            }
          );
          return true;
          
        case 'show_notification':
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/image_48.png',
            title: request.title,
            message: request.message
          });
          sendResponse({success: true});
          return true;
      }
    });
  }

  async handleTranslation(word, sendResponse, saveToDictionary = true) {
    try {
      const apiUrl = `${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.TRANSLATE}`;
      const response = await fetchWithRetry(`${apiUrl}?word=${encodeURIComponent(word)}`);
      
      // 检查响应状态
      if (!response.ok) {
        console.error('翻译API请求失败:', response.status);
        // 回退到原虚拟翻译
        const fallbackTranslation = `${word}的翻译`;
        if (saveToDictionary) {
          await this.saveWord(word, fallbackTranslation);
        }
        sendResponse({translation: fallbackTranslation});
        return;
      }
      
      let result;
      try {
        result = await response.json();
      } catch (jsonError) {
        console.error('翻译API返回数据格式错误:', jsonError);
        // 回退到原虚拟翻译
        const fallbackTranslation = `${word}的翻译`;
        if (saveToDictionary) {
          await this.saveWord(word, fallbackTranslation);
        }
        sendResponse({translation: fallbackTranslation});
        return;
      }
      
      // 处理可能的乱码情况
      const translation = this.sanitizeTranslation(result?.text) || `${word}的翻译`;
      
      // 只保存到字典，不获取音标
      if (saveToDictionary) {
        await this.saveWord(word, translation);
      }
      
      sendResponse({
        translation
      });
    } catch (error) {
      console.error('翻译失败:', error);
      // 回退到原虚拟翻译
      const fallbackTranslation = `${word}的翻译`;
      if (saveToDictionary) {
        await this.saveWord(word, fallbackTranslation);
      }
      sendResponse({translation: fallbackTranslation});
    }
  }
  
  // 清理翻译结果，处理乱码情况
  sanitizeTranslation(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // 检测并清理乱码
    const cleanedText = text
      // 移除不可见字符
      .replace(/[\x00-\x1F\x7F]/g, '')
      // 替换可能的乱码序列
      .replace(/æµè¯/g, '测试')
      // 移除多余空格
      .trim();
    
    return cleanedText;
  }

  async saveWord(word, translation) {
    const dict = await this.getDictionary();
    if (!dict[word]) {
      // 先创建基本词条，不自动获取音标
      const now = Date.now();
      dict[word] = {
        translation,
        phonetics: '', // 初始化为空字符串，后续手动获取
        added: now,
        reviewed: 0,
        correctReviews: 0, // 正确复习次数
        lastReviewed: null, // 最后复习时间
        lastModified: now // 最后修改时间
      };
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
  }

  async removeMark(markId) {
    const marks = await this.getMarks();
    delete marks[markId];
    await chrome.storage.local.set({[this.storageKeys.marks]: marks});
  }
  
  async removeAllMarksForWord(word) {
    const marks = await this.getMarks();
    // 移除所有匹配该单词的标记
    for (const [id, mark] of Object.entries(marks)) {
      if (mark.text === word) {
        delete marks[id];
      }
    }
    await chrome.storage.local.set({[this.storageKeys.marks]: marks});
  }

  async saveMark(markData) {
    const marks = await this.getMarks();
    marks[markData.id] = {
      text: markData.text,
      translation: markData.translation,
      timestamp: Date.now()
    };
    await chrome.storage.local.set({[this.storageKeys.marks]: marks});
  }

  async getDictionary() {
    const result = await chrome.storage.local.get(this.storageKeys.words);
    return result[this.storageKeys.words] || {};
  }

  async getMarks() {
    const result = await chrome.storage.local.get(this.storageKeys.marks);
    return result[this.storageKeys.marks] || {};
  }

  async deleteWord(word) {
    const dict = await this.getDictionary();
    delete dict[word];
    await chrome.storage.local.set({[this.storageKeys.words]: dict});
    
    // 同时清理相关标记
    const marks = await this.getMarks();
    for (const [id, mark] of Object.entries(marks)) {
      if (mark.text === word) {
        delete marks[id];
      }
    }
    await chrome.storage.local.set({[this.storageKeys.marks]: marks});
  }
  
  async deleteWords(words) {
    console.log('批量删除单词:', words);
    
    // 获取当前字典
    const dict = await this.getDictionary();
    
    // 获取当前标记
    const marks = await this.getMarks();
    
    // 删除所有指定单词
    words.forEach(word => {
      console.log(`删除单词: ${word}`);
      delete dict[word];
      
      // 同时删除相关标记
      for (const [id, mark] of Object.entries(marks)) {
        if (mark.text === word) {
          delete marks[id];
        }
      }
    });
    
    // 保存更新后的字典和标记
    await chrome.storage.local.set({[this.storageKeys.words]: dict});
    await chrome.storage.local.set({[this.storageKeys.marks]: marks});
    
    console.log('批量删除完成，删除了', words.length, '个单词');
  }

  async updateTranslation(word, translation) {
    const dict = await this.getDictionary();
    if (dict[word]) {
      dict[word].translation = translation;
      dict[word].lastModified = Date.now();
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
  }
  
  async updatePhonetic(word, phonetic) {
    const dict = await this.getDictionary();
    if (dict[word]) {
      dict[word].phonetics = phonetic;
      dict[word].lastModified = Date.now();
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
  }

  async updateReviewCount(word, isCorrect = true) {
    const dict = await this.getDictionary();
    if (dict[word]) {
      // 更新复习次数
      dict[word].reviewed = (dict[word].reviewed || 0) + 1;
      
      // 更新正确复习次数
      dict[word].correctReviews = (dict[word].correctReviews || 0) + (isCorrect ? 1 : 0);
      
      // 更新最后复习时间
      dict[word].lastReviewed = Date.now();
      
      // 更新最后修改时间
      dict[word].lastModified = Date.now();
      
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
    return dict[word]?.reviewed || 0;
  }

  async getPhonetics(word) {
    try {
      // 如果是词组(包含空格)，跳过音标获取
      if (word.includes(' ') || word.length === 0) {
        return {
          phoneticText: '',
          audioUrl: '' // 保留字段以保持向后兼容
        };
      }
      
      const apiUrl = `${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.PHONETICS}`;
      const response = await fetchWithRetry(`${apiUrl}?word=${encodeURIComponent(word)}`);
      
      // 检查响应状态，只处理成功的响应
      if (!response.ok) {
        console.error('获取音标失败: API请求失败:', response.status);
        return {
          phoneticText: '',
          audioUrl: ''
        };
      }
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('音标API返回数据格式错误:', jsonError);
        return {
          phoneticText: '',
          audioUrl: ''
        };
      }
      
      return {
        phoneticText: data?.phoneticText || '',
        audioUrl: '' // 不再获取音频URL，直接返回空字符串
      };

    } catch (error) {
      console.error('获取音标失败:', error);
      return {
        phoneticText: '',
        audioUrl: ''
      };
    }
  }
}

// 初始化
new ExtensionBackground();