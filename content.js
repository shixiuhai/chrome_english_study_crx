// 标记单词样式
const highlightStyle = {
  textDecoration: 'underline',
  textDecorationColor: '#5a95f5',
  textDecorationThickness: '2px',
  cursor: 'pointer',
  position: 'relative'
};

// 标记选中的文本
const markSelectedText = () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText) {
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.className = 'marked-word';
    
    // 为标记创建唯一ID
    const wordId = 'word_' + Date.now() + Math.random().toString(36).substr(2,5);
    
    // 保存标记位置信息
    const rect = range.getBoundingClientRect();
    const wordInfo = {
      id: wordId,
      text: selectedText,
      pageUrl: window.location.href,
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    };

    span.dataset.wordId = wordId;
    Object.assign(span.style, highlightStyle);
    
    // 添加翻译容器
    const translationDiv = document.createElement('div');
    translationDiv.className = 'word-translation';
    translationDiv.style.display = 'none';
    translationDiv.style.position = 'absolute';
    translationDiv.style.left = '0';
    translationDiv.style.top = '100%';
    translationDiv.style.backgroundColor = 'white';
    translationDiv.style.padding = '2px 5px';
    translationDiv.style.borderRadius = '3px';
    translationDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
    translationDiv.style.zIndex = '1000';
    
    span.appendChild(range.cloneContents());
    span.appendChild(translationDiv);
    range.deleteContents();
    range.insertNode(span);
    
    // 保存标记
    chrome.runtime.sendMessage({
      type: 'save_marked_word',
      wordInfo: wordInfo
    });

    // 点击显示翻译
    span.addEventListener('click', async (e) => {
      e.stopPropagation();
      const word = span.firstChild.textContent;
      const response = await chrome.runtime.sendMessage({
        type: 'translate', 
        word: word
      });
      
      translationDiv.textContent = response.translation;
      translationDiv.style.display = 'block';
    });

    // 点击空白处隐藏翻译
    document.addEventListener('click', (e) => {
      if (!span.contains(e.target)) {
        translationDiv.style.display = 'none';
      }
    });
  }
};

// 页面加载时恢复标记
const restoreMarkedWords = async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'get_marked_words'
  });
  
  const markedWords = response.markedWords || {};
  Object.values(markedWords)
    .filter(word => word.pageUrl === window.location.href)
    .forEach(word => {
      const span = document.createElement('span');
      span.className = 'marked-word-restored';
      span.dataset.wordId = word.id;
      Object.assign(span.style, highlightStyle);
      
      const textNode = document.createTextNode(word.text);
      span.appendChild(textNode);
      
      // 尝试找到原位置插入
      const element = document.elementFromPoint(word.position.x, word.position.y);
      if (element) {
        element.textContent = element.textContent.replace(word.text, span.outerHTML);
      }
    });
};

// 初始化
document.addEventListener('DOMContentLoaded', restoreMarkedWords);
document.addEventListener('mouseup', markSelectedText);