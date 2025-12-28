// 配置参数
const config = {
  maxWords: 50 // 最大保存单词数
};

// 标记存储管理器
class MarkStorage {
  constructor() {
    this.marksKey = 'saved_marks';
    this.dictKey = 'word_dictionary';
    this.initMessageHandlers();
  }

  // 初始化消息处理
  initMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch(request.type) {
        case 'save_mark':
          this.handleSaveMark(request.mark, sendResponse);
          return true;
          
        case 'get_marks':
          this.handleGetMarks(sendResponse);
          return true;
          
        case 'translate':
          this.handleTranslate(request.word, sendResponse);
          return true;
      }
    });
  }

  // 处理保存标记
  async handleSaveMark(mark, sendResponse) {
    try {
      // 保存标记HTML
      const marks = await this.getMarks();
      marks[mark.id] = {
        text: mark.text,
        html: mark.html,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({[this.marksKey]: marks});
      
      // 添加到单词本
      await this.addToDictionary(mark.text);
      
      sendResponse({success: true});
    } catch (error) {
      sendResponse({error: error.message});
    }
  }

  // 处理获取标记
  async handleGetMarks(sendResponse) {
    const marks = await this.getMarks();
    sendResponse({marks});
  }

  // 处理翻译请求
  async handleTranslate(word, sendResponse) {
    try {
      // 测试用翻译
      const translation = `${word}的翻译结果`;
      
      // 添加到单词本
      await this.addToDictionary(word);
      
      sendResponse({translation});
    } catch (error) {
      sendResponse({error: error.message});
    }
  }

  // 获取所有标记
  async getMarks() {
    const result = await chrome.storage.local.get(this.marksKey);
    return result[this.marksKey] || {};
  }

  // 添加到单词本
  async addToDictionary(word) {
    const dict = await this.getDictionary();
    if (!dict[word]) {
      dict[word] = {
        added: Date.now(),
        reviewed: 0
      };
      await chrome.storage.local.set({[this.dictKey]: dict});
    }
  }

  // 获取单词本
  async getDictionary() {
    const result = await chrome.storage.local.get(this.dictKey);
    return result[this.dictKey] || {};
  }
}

// 初始化
new MarkStorage();