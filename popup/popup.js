// 获取单词列表容器
const wordListElement = document.getElementById('wordList');

// 渲染单词列表
const renderWordList = async () => {
  const words = await chrome.storage.local.get('words');
  const wordList = words.words || [];

  wordListElement.innerHTML = '';
  
  wordList.forEach(word => {
    const wordItem = document.createElement('div');
    wordItem.className = 'word-item';
    
    wordItem.innerHTML = `
      <div>
        <span class="word-text">${word.word}</span>
        <span class="word-translation">${word.translation}</span>
        <div class="word-meta">
          添加于 ${new Date(word.addedAt).toLocaleDateString()}
        </div>
      </div>
    `;
    
    wordListElement.appendChild(wordItem);
  });
};

// 初始加载单词列表
document.addEventListener('DOMContentLoaded', renderWordList);

// 监听存储变化实时更新
chrome.storage.onChanged.addListener((changes) => {
  if (changes.words) {
    renderWordList();
  }
});