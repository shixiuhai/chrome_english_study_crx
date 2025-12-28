class WordBook {
  constructor() {
    this.wordListElement = document.getElementById('wordList');
    this.searchInput = document.querySelector('.search-box input');
    this.words = [];
    
    this.init();
  }

  async init() {
    this.setupLoadingUI();
    try {
      await this.loadWords();
      this.renderWordList();
      this.setupEventListeners();
    } catch (error) {
      this.showError('加载单词本失败，请重试');
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
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('获取单词本失败:', chrome.runtime.lastError);
            this.showError('连接插件失败');
            resolve([]);
            return;
          }
          
          this.words = Object.entries(response?.dictionary || {}).map(([word, data]) => ({
            word,
            translation: data?.translation || '',
            added: data?.added || Date.now(),
            reviewed: data?.reviewed || 0
          })).sort((a, b) => b.added - a.added);
          
          resolve();
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
            <button class="edit-btn" title="编辑">✏️</button>
            <button class="delete-btn" title="删除">🗑️</button>
          </div>
        </div>
        <div class="word-body">
          <div class="word-translation">${wordData.translation || '暂无翻译'}</div>
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
  new WordBook();
});