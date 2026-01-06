// Chrome插件后台脚本 - 单词学习助手

// 配置对象（直接定义，因为service worker没有window对象）
const CONFIG = {
  // API基础URL
  API_BASE_URL: 'http://chrome.yizhiweb.top:8080',
  
  // API端点
  ENDPOINTS: {
    TRANSLATE: '/wx/chrome/crx/translate',
    PHONETICS: '/wx/chrome/crx/phonetics'
  },
  
  // 存储键名
  STORAGE_KEYS: {
    DICTIONARY: 'word_dictionary',
    MARKS: 'word_marks'
  }
};

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
          this.handleTranslation(request.word, sendResponse);
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
            
        case 'update_translation':
          this.updateTranslation(request.word, request.translation)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'update_review_count':
          this.updateReviewCount(request.word)
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
          
        case 'get_phonetics':
          this.getPhonetics(request.word)
            .then(phonetics => sendResponse({phonetics}));
          return true;
          
        case 'show_notification':
          chrome.notifications.create({
            type: 'basic',
            iconUrl: './icons/icon48.png',
            title: request.title,
            message: request.message
          });
          sendResponse({success: true});
          return true;
      }
    });
  }

  async handleTranslation(word, sendResponse) {
    const requestOptions = {
      method: 'GET',
      redirect: 'follow'
    };

    try {
      const apiUrl = `${CONFIG.API_BASE_URL || 'http://chrome.yizhiweb.top:8080'}${CONFIG.ENDPOINTS.TRANSLATE || '/wx/chrome/crx/translate'}`;
      const response = await fetch(`${apiUrl}?word=${encodeURIComponent(word)}`, requestOptions);
      if (!response.ok) {
        throw new Error(`翻译API请求失败: ${response.status}`);
      }
      const result = await response.json();
      const translation = result?.text || `${word}的翻译`;
      
      // 保存到字典并获取音标
      await this.saveWord(word, translation);
      
      const phonetics = await this.getPhonetics(word);
      sendResponse({
        translation,
        phonetics
      });
    } catch (error) {
      console.error('翻译失败:', error);
      // 回退到原虚拟翻译
      const fallbackTranslation = `${word}的翻译`;
      await this.saveWord(word, fallbackTranslation);
      sendResponse({translation: fallbackTranslation});
    }
  }

  async saveWord(word, translation) {
    const dict = await this.getDictionary();
    if (!dict[word]) {
      // 先创建基本词条
      const phoneticsData = await this.getPhonetics(word);
      dict[word] = {
        translation,
        phonetics: phoneticsData.phoneticText, // 只存储音标文本
        added: Date.now(),
        reviewed: 0
      };
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
  }

  async removeMark(markId) {
    const marks = await this.getMarks();
    delete marks[markId];
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

  async updateTranslation(word, newTranslation) {
    const dict = await this.getDictionary();
    if (dict[word]) {
      dict[word].translation = newTranslation;
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
  }

  async updateReviewCount(word) {
    const dict = await this.getDictionary();
    if (dict[word]) {
      dict[word].reviewed = (dict[word].reviewed || 0) + 1;
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
    return dict[word]?.reviewed || 0;
  }

  async getPhonetics(word) {
    try {
      // 如果是词组(包含空格)，跳过音标获取
      if (word.includes(' ')) {
        return {
          phoneticText: '',
          audioUrl: ''
        };
      }
      
      const apiUrl = `${CONFIG.API_BASE_URL || 'http://chrome.yizhiweb.top:8080'}${CONFIG.ENDPOINTS.PHONETICS || '/wx/chrome/crx/phonetics'}`;
      const response = await fetch(`${apiUrl}?word=${encodeURIComponent(word)}`);
      const data = await response.json();
      
      return {
        phoneticText: data?.phoneticText || '',
        audioUrl: data?.audioUrl || ''
      };

    } catch (error) {
      console.error('获取音标失败:', error);
      return {
        phoneticText: '',
        audioUrl: ''
      };
    }
  }

  async batchGetPhonetics(words) {
    return Promise.all(words.map(word => this.getPhonetics(word)));
  }

  async batchUpdatePhonetics(updates) {
    const dict = await this.getDictionary();
    updates.forEach(({word, phonetics}) => {
      if (dict[word]) {
        dict[word].phonetics = phonetics;
      }
    });
    await chrome.storage.local.set({[this.storageKeys.words]: dict});
  }
}

// 初始化
new ExtensionBackground();