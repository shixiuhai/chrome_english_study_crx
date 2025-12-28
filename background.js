// Chrome插件后台脚本 - 单词学习助手

class ExtensionBackground {
  constructor() {
    this.storageKeys = {
      words: 'word_dictionary',
      marks: 'word_marks'
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
            
        case 'save_mark':
          this.saveMark(request.markData)
            .then(() => sendResponse({success: true}));
          return true;
            
        case 'get_marks': 
          this.getMarks()
            .then(marks => sendResponse({marks}));
          return true;
      }
    });
  }

  async handleTranslation(word, sendResponse) {
    // 临时翻译实现 - 用户可替换为真实API调用
    const translation = `${word}的翻译`;
    
    // 保存到字典
    await this.saveWord(word, translation);
    
    sendResponse({translation});
  }

  async saveWord(word, translation) {
    const dict = await this.getDictionary();
    if (!dict[word]) {
      dict[word] = {
        translation,
        added: Date.now(),
        reviewed: 0
      };
      await chrome.storage.local.set({[this.storageKeys.words]: dict});
    }
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
}

// 初始化
new ExtensionBackground();