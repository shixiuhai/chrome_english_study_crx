class WordBook {
  constructor() {
    this.wordListElement = document.getElementById('wordList');
    this.searchInput = document.querySelector('.search-box input');
    this.words = [];
    
    this.init();
  }

  async init() {
    await this.loadWords();
    this.renderWordList();
    this.setupEventListeners();
  }

  async loadWords() {
    try {
      const response = await chrome.runtime.sendMessage({type: 'get_dictionary'});
      this.words = Object.entries(response.dictionary || {}).map(([word, data]) => ({
        word,
        translation: data.translation || `${word}的翻译`,
        added: data.added || Date.now(),
        reviewed: data.reviewed || 0
      }));
      this.words.sort((a, b) => b.added - a.added);
    } catch (error) {
      console.error('加载单词失败:', error);
    }
  }

  renderWordList() {
    this.wordListElement.innerHTML = '';
    
    this.words.forEach((wordData, index) => {
      const wordCard = document.createElement('div');
      wordCard.className = 'word-card';
      wordCard.dataset.index = index;
      
      wordCard.innerHTML = `
        <div class="word-header">
          <span class="word-text">${wordData.word}</span>
          <div class="word-actions">
            <button class="edit-btn" title="编辑">✏️</button>
            <button class="delete-btn" title="删除">🗑️</button>
          </div>
        </div>
        <div class="word-translation">${wordData.translation}</div>
        <div class="word-meta">
          <span>添加于 ${new Date(wordData.added).toLocaleDateString()}</span>
          <span>复习 ${wordData.reviewed} 次</span>
        </div>
      `;
      
      this.wordListElement.appendChild(wordCard);
    });
  }

  setupEventListeners() {
    // 搜索功能
    this.searchInput.addEventListener('input', () => {
      const searchTerm = this.searchInput.value.toLowerCase();
      const cards = this.wordListElement.querySelectorAll('.word-card');
      
      cards.forEach(card => {
        const word = card.querySelector('.word-text').textContent.toLowerCase();
        card.style.display = word.includes(searchTerm) ? '' : 'none';
      });
    });

    // 删除单词
    this.wordListElement.addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-btn')) {
        const card = e.target.closest('.word-card');
        const index = card.dataset.index;
        const word = this.words[index].word;
        
        if (confirm(`确定要删除单词 "${word}" 吗?`)) {
          await chrome.runtime.sendMessage({
            type: 'delete_word',
            word: word
          });
          await this.loadWords();
          this.renderWordList();
        }
      }
      
      // 编辑单词
      if (e.target.classList.contains('edit-btn')) {
        const card = e.target.closest('.word-card');
        const index = card.dataset.index;
        this.editWord(index, card);
      }
    });
  }

  async editWord(index, card) {
    const wordData = this.words[index];
    const translationElement = card.querySelector('.word-translation');
    
    const originalTranslation = translationElement.textContent;
    translationElement.innerHTML = `
      <input type="text" value="${originalTranslation}" class="edit-translation">
      <button class="save-btn">保存</button>
      <button class="cancel-btn">取消</button>
    `;
    
    const saveBtn = translationElement.querySelector('.save-btn');
    const cancelBtn = translationElement.querySelector('.cancel-btn');
    const input = translationElement.querySelector('.edit-translation');
    
    input.focus();
    
    saveBtn.addEventListener('click', async () => {
      const newTranslation = input.value.trim();
      if (newTranslation && newTranslation !== originalTranslation) {
        await chrome.runtime.sendMessage({
          type: 'update_translation',
          word: wordData.word,
          translation: newTranslation
        });
        await this.loadWords();
        this.renderWordList();
      }
    });
    
    cancelBtn.addEventListener('click', () => {
      translationElement.textContent = originalTranslation;
    });
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      }
    });
  }
}

// 初始化单词本
new WordBook();