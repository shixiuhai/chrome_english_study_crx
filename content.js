// 转义正则特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class WordMarker {
  constructor() {
    this.markedWords = new Map();
    this.init();
    this.initPageMarks(); // 新增初始化调用
  }

  init() {
    // 检查是否已标记，防止重复
    const markCheck = (text) => !this.isAlreadyMarked(text);
    
    document.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      if (text && markCheck(text)) {
        this.markWord(selection, text);
      }
    });
  }

  // 新增方法：初始化页面标记
  async initPageMarks() {
    const marks = await this.getMarks();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.parentNode.nodeName === 'SCRIPT' || node.parentNode.nodeName === 'STYLE') {
        continue;
      }

      Object.values(marks).forEach((mark) => {
        const regex = new RegExp(escapeRegExp(mark.text), 'gi');
        if (regex.test(node.nodeValue)) {
          this.markExistingWord(node, mark);
        }
      });
    }
  }

  // 辅助方法：标记已存在的单词
  async markExistingWord(textNode, markData) {
    const range = document.createRange();
    const index = textNode.nodeValue.indexOf(markData.text);
    
    if (index >= 0) {
      range.setStart(textNode, index);
      range.setEnd(textNode, index + markData.text.length);
      
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      
      await this.markWord(selection, markData.text);
    }
  }

  // 新增：获取所有标记
  async getMarks() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: 'get_marks'},
        (response) => resolve(response.marks)
      );
    });
  }

  isAlreadyMarked(text) {
    for (const [_, word] of this.markedWords) {
      if (word.text === text) return true;
    }
    return false;
  }


  async markWord(selection, text) {
    const range = selection.getRangeAt(0);
    const markId = `mark_${Date.now()}`;
    
    const translation = await this.getTranslation(text);
    this.createMarkElement(range, text, translation, markId);
    
    this.markedWords.set(markId, {text, translation});
    this.saveMark({id: markId, text, translation});
  }

  createMarkElement(range, text, translation, id) {
    const mark = document.createElement('span');
    mark.className = 'word-mark';
    mark.dataset.markId = id;
    mark.style.textDecoration = 'underline #1e90ff 2px';
    mark.style.position = 'relative';
    mark.style.cursor = 'pointer';

    const tooltip = document.createElement('div');
    tooltip.className = 'word-tooltip';
    tooltip.textContent = translation;
    tooltip.style.cssText = `
      position: absolute;
      left: 0;
      top: 100%;
      background: white;
      padding: 5px;
      border: 1px solid #ddd;
      border-radius: 3px;
      z-index: 1000;
      display: none;
    `;

    // 改进的悬浮窗显示控制
    mark.addEventListener('mouseenter', () => {
      tooltip.style.display = 'block';
    });
    
    mark.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });

    mark.appendChild(range.cloneContents());
    mark.appendChild(tooltip);
    range.deleteContents();
    range.insertNode(mark);
  }

  async getTranslation(text) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {type: 'translate', word: text},
        (response) => resolve(response.translation)
      );
    });
  }

  async saveMark(markData) {
    chrome.runtime.sendMessage({
      type: 'save_mark',
      markData
    });
  }
}

new WordMarker();