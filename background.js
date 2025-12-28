// 单词存储管理
const wordStore = {
  // 添加/更新标记单词
  addMarkedWord: async (wordInfo) => {
    const words = await chrome.storage.local.get('markedWords');
    const markedWords = words.markedWords || {};
    markedWords[wordInfo.id] = wordInfo;
    await chrome.storage.local.set({markedWords});
  },

  // 获取所有标记单词
  getAllMarkedWords: async () => {
    const data = await chrome.storage.local.get('markedWords');
    return data.markedWords || {};
  },

  // 添加单词到存储
  addWord: async (word, translation) => {
    const words = await chrome.storage.local.get('words');
    const wordsList = words.words || [];
    
    const exists = wordsList.some(w => w.word === word);
    if (!exists) {
      wordsList.push({
        word,
        translation,
        addedAt: Date.now(),
        reviewed: 0
      });
      await chrome.storage.local.set({words: wordsList});
    }
  },

  // 获取所有单词
  getAllWords: async () => {
    const data = await chrome.storage.local.get('words');
    return data.words || [];
  }
};

// 测试用恒定翻译结果
const translateAPI = {
  translate: async (word) => {
    return new Promise((resolve) => {
      resolve(`${word}的测试翻译`);
    });
  }
};

// 监听内容脚本的消息
chrome.runtime.onMessage.addListener(
  async (request, sender, sendResponse) => {
    switch(request.type) {
      case 'translate':
        const translation = await translateAPI.translate(request.word);
        await wordStore.addWord(request.word, translation);
        sendResponse({translation});
        break;
        
      case 'save_marked_word':
        await wordStore.addMarkedWord(request.wordInfo);
        sendResponse({success: true});
        break;
        
      case 'get_marked_words':
        const markedWords = await wordStore.getAllMarkedWords();
        sendResponse({markedWords});
        break;
    }
  }
);