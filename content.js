// 标记样式配置
const HIGHLIGHT_STYLE = {
  underlineColor: '#1e90ff', // 蓝色下划线
  underlineWidth: '2px',
  translationBg: '#ffffff',
  translationBorder: '#ccc'
};

// 单词标记管理器
class WordMarker {
  constructor() {
    this.markedWords = new Map();
    this.initEventListeners();
    this.restoreMarks();
  }

  // 初始化事件监听
  initEventListeners() {
    document.addEventListener('mouseup', this.handleSelection.bind(this));
  }

  // 处理文本选择
  async handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const markId = 'mark_' + Date.now();
    
    // 创建标记元素
    const markElement = this.createMarkElement(markId, range, selectedText);
    
    // 存储标记
    this.markedWords.set(markId, {
      element: markElement,
      text: selectedText
    });

    // 获取并显示翻译
    const translation = await this.getTranslation(selectedText);
    this.showTranslation(markElement, translation);
    
    // 保存标记
    this.saveMark(markId, selectedText, markElement.innerHTML);
  }

  // 创建标记元素
  createMarkElement(id, range, text) {
    const span = document.createElement('span');
    span.className = 'word-mark';
    span.dataset.markId = id;
    span.style.textDecoration = `underline ${HIGHLIGHT_STYLE.underlineColor}`;
    span.style.textDecorationThickness = HIGHLIGHT_STYLE.underlineWidth;
    span.style.position = 'relative';
    span.style.cursor = 'pointer';

    // 添加翻译容器
    const translationDiv = document.createElement('div');
    translationDiv.className = 'translation-display';
    translationDiv.style.display = 'none';
    translationDiv.style.position = 'absolute';
    translationDiv.style.left = '0';
    translationDiv.style.top = '100%';
    translationDiv.style.backgroundColor = HIGHLIGHT_STYLE.translationBg;
    translationDiv.style.border = `1px solid ${HIGHLIGHT_STYLE.translationBorder}`;
    translationDiv.style.padding = '5px';
    translationDiv.style.borderRadius = '3px';
    translationDiv.style.zIndex = '1000';

    // 添加悬停事件
    span.addEventListener('mouseover', (e) => {
      e.stopPropagation();
      translationDiv.style.display = 'block';
    });
    
    span.addEventListener('mouseout', () => {
      translationDiv.style.display = 'none';
    });

    span.appendChild(range.cloneContents());
    span.appendChild(translationDiv);
    range.deleteContents();
    range.insertNode(span);

    return span;
  }

  // 获取翻译
  async getTranslation(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'translate',
        word: text
      }, (response) => {
        resolve(response.translation);
      });
    });
  }

  // 显示翻译
  showTranslation(element, translation) {
    const translationDiv = element.querySelector('.translation-display');
    if (translationDiv) {
      translationDiv.textContent = translation;
    }
  }

  // 保存标记
  saveMark(id, text, html) {
    chrome.runtime.sendMessage({
      type: 'save_mark',
      mark: { id, text, html }
    });
  }

  // 恢复标记
  async restoreMarks() {
    const marks = await new Promise((resolve) => {
      chrome.runtime.sendMessage({type: 'get_marks'}, (response) => {
        resolve(response.marks);
      });
    });

    Object.values(marks || {}).forEach(mark => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = mark.html;
      const markElement = tempDiv.firstChild;
      
      // 放到原位置
      const textNodes = this.findTextNodes(document.body, mark.text);
      if (textNodes.length > 0) {
        const range = document.createRange();
        range.selectNodeContents(textNodes[0]);
        range.surroundContents(markElement);
        
        // 重新添加事件
        markElement.addEventListener('mouseover', (e) => {
          const translationDiv = e.target.querySelector('.translation-display');
          if (translationDiv) translationDiv.style.display = 'block';
        });
        
        markElement.addEventListener('mouseout', (e) => {
          const translationDiv = e.target.querySelector('.translation-display');
          if (translationDiv) translationDiv.style.display = 'none';
        });

        this.markedWords.set(mark.id, {
          element: markElement,
          text: mark.text
        });
      }
    });
  }

  // 查找文本节点
  findTextNodes(element, text) {
    const nodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim() === text.trim()) {
        nodes.push(node);
      }
    }

    return nodes;
  }
}

// 初始化
new WordMarker();