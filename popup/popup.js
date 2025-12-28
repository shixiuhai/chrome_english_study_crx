class WordBook {
  constructor() {
    this.wordListElement = document.getElementById('wordList');
    this.searchInput = document.querySelector('.search-box input');
    this.words = [];
    
    this.init();
  }

  // 添加朗读方法
  async speakWord(word) {
    try {
      const audioUrl = await new Promise((resolve) => {
        chrome.storage.local.get(`audio_${word}`, (result) => {
          resolve(result[`audio_${word}`] || '');
        });
      });

      if (audioUrl) {
        // 使用API提供的真实发音
        const audio = new Audio(audioUrl);
        audio.play();
      } else {
        // 回退到浏览器TTS
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('播放发音失败:', error);
      // 最终回退方案
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      speechSynthesis.speak(utterance);
    }
  }

  async init() {
    this.setupLoadingUI();
    try {
      await this.loadWordsWithPhonetics();
      this.renderWordList();
      this.setupEventListeners();
    } catch (error) {
      this.showError('加载单词本失败，请重试');
    }
  }

  async loadWordsWithPhonetics() {
    await this.loadWords();
    
    // 为没有音标的单词获取音标
    for (const wordData of this.words) {
      if (!wordData.phonetics) {
        wordData.phonetics = await this.getPhonetics(wordData.word);
        
        // 更新存储
        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'update_phonetics',
            word: wordData.word,
            phonetics: wordData.phonetics
          }, resolve);
        });
      }
    }
  }

  async getPhonetics(word) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {type: 'get_phonetics', word},
          response => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            // 使用API返回的正确音标字段
            const phoneticText = response?.phonetic ||
                               response?.phonetics?.[0]?.text ||
                               '';
            resolve(phoneticText || '');
          }
        );
      });
    } catch (error) {
      console.error('获取音标失败:', error);
      return '';
    }
  }

  setupLoadingUI() {
    this.wordListElement.innerHTML = '<div class="loading">加载单词本中...</div>';
  }

  showError(message) {
    this.wordListElement.innerHTML = `<div class="error">${message}</div>`;
  }

  async loadWords() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {type: 'get_dictionary'},
        async (response) => {  // 添加async标记
          if (chrome.runtime.lastError) {
            console.error('获取单词本失败:', chrome.runtime.lastError);
            this.showError('连接插件失败');
            resolve([]);
            return;
          }
          
          try {
            const entries = Object.entries(response?.dictionary || {});
            const wordPromises = entries.map(async ([word, data]) => {
              const phonetics = data?.phonetics || await this.getPhonetics(word);
              return {
                word,
                translation: data?.translation || '',
                phonetics,
                added: data?.added || Date.now(),
                reviewed: data?.reviewed || 0
              };
            });
            
            this.words = await Promise.all(wordPromises);
            this.words.sort((a, b) => b.added - a.added);
            resolve();
          } catch (error) {
            console.error('加载单词出错:', error);
            this.showError('加载单词数据出错');
            resolve([]);
          }
        }
      );
    });
  }

  renderWordList() {
    this.wordListElement.innerHTML = '';
    
    if (this.words.length === 0) {
      this.wordListElement.innerHTML = '<div class="empty">单词本为空</div>';
      return;
    }
    
    this.words.forEach((wordData, index) => {
      const wordCard = document.createElement('div');
      wordCard.className = 'word-card';
      wordCard.dataset.word = wordData.word;
      
      wordCard.innerHTML = `
        <div class="word-header">
          <span class="word-text">${wordData.word}</span>
          <div class="word-actions">
            <button class="speak-btn" title="朗读">🔊</button>
            <button class="edit-btn" title="编辑">✏️</button>
            <button class="delete-btn" title="删除">🗑️</button>
          </div>
        </div>
        <div class="word-body">
          <div class="word-translation">${wordData.translation || '暂无翻译'}</div>
          ${wordData.phonetics ? `<div class="word-phonetics">/${wordData.phonetics}/</div>` : ''}
          <div class="word-meta">
            <span>添加于 ${new Date(wordData.added).toLocaleDateString()}</span>
            <span>复习次数: ${wordData.reviewed}</span>
          </div>
        </div>
      `;
      
      this.wordListElement.appendChild(wordCard);
    });
  }

  setupEventListeners() {
    // 搜索功能
    this.searchInput.addEventListener('input', this.handleSearch.bind(this));
    
    // 删除单词
    this.wordListElement.addEventListener('click', this.handleWordActions.bind(this));
  }

  handleSearch() {
    const term = this.searchInput.value.toLowerCase().trim();
    this.wordListElement.querySelectorAll('.word-card').forEach(card => {
      const word = card.dataset.word.toLowerCase();
      card.style.display = word.includes(term) ? '' : 'none';
    });
  }

  handleWordActions(e) {
    if (e.target.classList.contains('delete-btn')) {
      this.handleDeleteWord(e);
    } 
    else if (e.target.classList.contains('edit-btn')) {
      this.handleEditWord(e);
    }
  }

  async handleDeleteWord(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    
    if (!confirm(`确定要删除单词 "${word}" 吗？`)) return;
    
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {type: 'delete_word', word},
          () => {
            if (chrome.runtime.lastError) {
              console.error('删除单词失败:', chrome.runtime.lastError);
              this.showError('删除单词失败');
              return;
            }
            resolve();
          }
        );
      });
      
      await this.loadWords();
      this.renderWordList();
    } catch (error) {
      console.error('删除出错:', error);
      this.showError('删除单词时出错');
    }
  }

  handleEditWord(e) {
    const card = e.target.closest('.word-card');
    const word = card.dataset.word;
    const translationDiv = card.querySelector('.word-translation');
    
    const originalText = translationDiv.textContent;
    translationDiv.innerHTML = `
      <textarea class="edit-area">${originalText}</textarea>
      <div class="edit-actions">
        <button class="save-edit-btn">保存</button>
        <button class="cancel-edit-btn">取消</button>
      </div>
    `;
    
    const textarea = translationDiv.querySelector('.edit-area');
    textarea.focus();
    
    translationDiv.querySelector('.save-edit-btn').addEventListener('click', () => {
      this.saveWordEdit(word, textarea.value.trim(), card);
    });
    
    translationDiv.querySelector('.cancel-edit-btn').addEventListener('click', () => {
      translationDiv.textContent = originalText;
    });
  }

  async saveWordEdit(word, newTranslation, card) {
    if (!newTranslation) {
      alert('翻译内容不能为空');
      return;
    }
    
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'update_translation',
            word,
            translation: newTranslation
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('更新翻译失败:', chrome.runtime.lastError);
              this.showError('保存翻译失败');
              return;
            }
            resolve();
          }
        );
      });
      
      await this.loadWords();
      this.renderWordList();
    } catch (error) {
      console.error('保存翻译出错:', error);
      this.showError('保存翻译时出错');
    }
  }
}

// 初始化单词本
document.addEventListener('DOMContentLoaded', () => {
  const wordBook = new WordBook();
  
  // 添加全局朗读点击处理
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('speak-btn')) {
      const word = e.target.closest('.word-card').dataset.word;
      wordBook.speakWord(word);
    }
  });
});