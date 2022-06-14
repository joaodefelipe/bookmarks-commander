/* global engine */
'use strict';

const args = new URLSearchParams(location.search);
if (args.has('width')) {
  document.documentElement.style.width = args.get('width') + 'px';
}
if (args.has('height')) {
  document.documentElement.style.height = args.get('height') + 'px';
}

const title = {
  'directory-view-1': '...',
  'directory-view-2': '...'
};

const toast = msg => {
  clearTimeout(toast.id);
  toast.id = setTimeout(() => {
    document.getElementById('toast').textContent = '';
  }, 2000);
  document.getElementById('toast').textContent = msg;
};

/* events */
// persist last visited paths and update title
document.addEventListener('directory-view:path', e => {
  const {detail} = e;
  const id = e.target.getAttribute('id');
  title[id] = detail.arr[detail.arr.length - 1].title;

  document.title = '[L] ' + title['directory-view-1'] + ' [R] ' + title['directory-view-2'];
  engine.storage.set({
    [id]: detail.id
  });
});
/* history */
document.addEventListener('directory-view:path', () => {
  const state = {
    'directory-view-1': views.left.id(),
    'directory-view-1-ids': views.left.entries().map(o => o.id),
    'directory-view-2': views.right.id(),
    'directory-view-2-ids': views.right.entries().map(o => o.id),
    'active': views.active() === views.left ? 'left' : 'right'
  };
  // do not push state if history.state is equal to the current state => state is set by history.state
  if (history.state) {
    if (
      JSON.stringify(history.state['directory-view-1']) === JSON.stringify(state['directory-view-1']) &&
      JSON.stringify(history.state['directory-view-2']) === JSON.stringify(state['directory-view-2'])
    ) {
      return;
    }
  }
  clearTimeout(history.id);
  history.id = setTimeout(() => {
    history[history.state ? 'pushState' : 'replaceState'](state, document.title);
  }, 100);
});
window.addEventListener('popstate', e => {
  if (history.state && history.state.active) {
    start(e.state);
  }
});
history.busy = false;

// user-action
document.addEventListener('directory-view:submit', e => {
  const {detail} = e;
  detail.entries.forEach(o => {
    if (o.type === 'DIRECTORY' && detail.entries.length === 1) {
      const {id, openerId} = detail.entries[0];
      // prevent looping
      if (openerId && openerId.id) {
        if (openerId.id.id) {
          e.target.build(openerId.id, undefined, [openerId.id.id]);
        }
        else {
          e.target.build(openerId.id, undefined, []);
        }
      }
      else if (openerId) {
        e.target.build(id, undefined, [openerId]);
      }
      else {
        e.target.build(id);
      }
    }
    else if (o.type === 'FILE') {
      if (detail.shiftKey) {
        engine.windows.create({
          url: o.url,
          incognito: detail.metaKey || detail.ctrlKey
        });
      }
      else if (detail.metaKey || detail.ctrlKey) {
        engine.tabs.create({
          url: o.url,
          active: false
        });
      }
      else {
        if (args.get('mode') === 'window') {
          engine.tabs.active().then(tab => engine.tabs.update(tab.id, {
            url: o.url
          })).catch(() => engine.tabs.create({
            url: o.url
          })).finally(() => window.close());
        }
        else {
          engine.tabs.update(undefined, {
            url: o.url
          });
        }
      }
    }
  });
});

// use shift key to drop inside a folder
document.addEventListener('directory-view:drop-request', async e => {
  const {ids, types, selected, source, destination, over} = e.detail;

  // cannot move to the root directory
  if (views[destination].isRoot()) {
    toast('Cannot move to the root directory');
    return;
  }
  // cannot move to a search directory
  if (views[destination].isSearch() && over.inside !== true) {
    toast('Cannot move to a search view');
    return;
  }
  // cannot move a directory to a child directory
  if (types.some(type => type === 'DIRECTORY')) {
    const d = views[destination].list();
    console.log(d);
    // if any selected directory is in the path of destination directory, prevent moving
    if (ids.some(id => d.some(de => de.id === id))) {
      toast('Cannot move to a child directory');
      return;
    }
  }

  const s = source === 'right' ? views.right : views.left;
  const d = destination === 'right' ? views.right : views.left;

  if (selected.some(s => s === 'true')) {
    s.navigate('previous');
  }

  // move inside a directory
  if (over.type === 'DIRECTORY' && over.inside) {
    for (const id of ids) {
      await engine.bookmarks.move(id, {
        parentId: over.id
      }).catch(engine.notify);
    }
  }
  // move after over or move after selected
  else {
    for (const id of ids) {
      const index = isNaN(over.index) ? Number(d.entries()[0].index) + 1 : Number(over.index) + 1;

      await engine.bookmarks.move(id, {
        parentId: d.id(),
        index
      }).catch(engine.notify);
    }
  }
  // update both views
  views.update();
});
document.addEventListener('directory-view:selection-changed', e => {
  const input = e.target.parentElement.querySelector('input[type=radio]');
  if (input) {
    input.click();
  }
  views.changed();

  engine.storage.set({
    [e.target.getAttribute('id') + '-ids']: e.target.entries().map(o => o.id)
  });
});
document.addEventListener('directory-view:content-updated', () => {
  views.changed();
});
{
  const commit = e => {
    command(e.detail.command, e.detail);
    views.active().click();
  };
  document.addEventListener('directory-view:command', commit);
  document.addEventListener('tools-view:command', commit);
  document.addEventListener('tools-view:blur', () => views.active().click());
}

engine.user.on('blur', () => views.active().click());

/* views */
const views = {
  'parent': document.getElementById('directories'),
  'left': document.getElementById('directory-view-1'),
  'right': document.getElementById('directory-view-2'),
  active(reverse = false) {
    let e = document.querySelector('input:checked + directory-view');
    if (reverse) {
      e = document.querySelector('input:not(:checked) + directory-view');
    }
    return e || views.left;
  },
  changed() {
    const active = views.active();
    const other = active === views.left ? views.right : views.left;

    const direction = active === views.left ? 'LEFT' : 'RIGHT';
    engine.storage.set({
      active: active === views.left ? 'left' : 'right'
    });
    const entries = active.entries();
    const uentries = active.entries(false);

    const readonly = entries.some(o => o.readonly === 'true');
    const directory = entries.some(o => o.type === 'DIRECTORY');
    const file = entries.some(o => o.type === 'FILE');


    // duplicate
    if (other.isSearch() || other.isRoot()) {
      toolsView.state('duplicate', false);
    }
    else {
      toolsView.state('duplicate', readonly ? false : true);
    }

    // move-left or move-right
    if (readonly) {
      toolsView.state('move-left', false);
      toolsView.state('move-right', false);
    }
    else {
      /* move-left or move-right*/
      for (const moveTo of ['left', 'right']) {
        let move = direction !== moveTo.toUpperCase();
        // cannot move to the root directory
        if (move && views[moveTo].isRoot()) {
          move = false;
        }
        // cannot move to a search directory
        if (move && views[moveTo].isSearch()) {
          move = false;
        }
        // cannot move a directory to a child directory
        if (move && directory) {
          const d = views[moveTo].list();
          if (d) {
            // if any selected directory is in the path of destination directory, prevent moving
            if (entries.some(e => d.some(de => de.id === e.id))) {
              move = false;
            }
          }
        }
        toolsView.state('move-' + moveTo, move);
      }
    }
    // delete
    toolsView.state('trash', readonly === false);
    // sort
    toolsView.state('sort', active.isRoot() === false && active.count > 1 && active.isSearch() === false);
    // copy-link
    toolsView.state('copy-link', file);
    active.state('copy-link', file);
    // edit-link
    toolsView.state('edit-link', readonly === false && file && entries.length === 1);
    // edit-title
    toolsView.state('edit-title', readonly === false && entries.length === 1);
    // new-file
    toolsView.state('new-file', active.isRoot() || active.isSearch() ? false : true);
    // new-directory (test; create directory on [..])
    toolsView.state('new-directory', active.isRoot() || active.isSearch() ? false : true);
    // import-tree;
    // allow on root; does not allow on back button; does not allow on search
    const imt = entries.length === 1 && active.isSearch() === false && (readonly === false || active.isRoot());
    toolsView.state('import-tree', imt);
    active.state('import-tree', imt);
    // sync
    if (
      views.left.isRoot() || views.left.isSearch() ||
      views.right.isRoot() || views.right.isSearch() ||
      views.left.id() === views.right.id()
    ) {
      toolsView.state('sync', false);
    }
    else {
      toolsView.state('sync', true);
    }
    // move
    const first = active.isRoot() === false && active.isSearch() === false &&
      entries.some(e => Number(e.index) === 0) === false;
    const last = active.isRoot() === false && active.isSearch() === false &&
      entries.some(e => Number(e.index) === uentries.length - 1) === false;
    toolsView.state('move-top', first);
    active.state('move-top', first);
    toolsView.state('move-up', first);
    active.state('move-up', first);
    toolsView.state('move-down', last);
    active.state('move-down', last);
    toolsView.state('move-bottom', last);
    active.state('move-bottom', last);
  },
  update() {
    views.left.update(views.left.id());
    views.right.update(views.right.id());
  }
};
views.left.owner('left');
views.right.owner('right');
const toolsView = document.getElementById('tools-view');

/* restore, and active a pane after DOM content is loaded */
const start = state => {
  document.getElementById('directory-view-1').build(
    state['directory-view-1'],
    undefined,
    state['directory-view-1-ids'] || []
  );
  document.getElementById('directory-view-2').build(
    state['directory-view-2'],
    undefined,
    state['directory-view-2-ids'] || []
  );

  views[state.active].click();
};
document.addEventListener('DOMContentLoaded', () => engine.storage.get({
  'directory-view-1': '',
  'directory-view-1-ids': [],
  'directory-view-2': '',
  'directory-view-2-ids': [],
  'active': 'left'
}).then(start));

const exporting = async (entries, e) => {
  const items = [];
  for (const entry of entries) {
    await engine.bookmarks.tree(entry.id).then(nodes => {
      const step = (parent, node) => {
        parent.title = node.title;
        parent.type = node.url ? 'FILE' : 'DIRECTORY';
        if (parent.type === 'FILE') {
          parent.url = node.url;
        }
        else {
          parent.children = [];
          for (const n of (node.children || [])) {
            const p = {};
            parent.children.push(p);
            step(p, n);
          }
        }
      };
      const root = {};
      step(root, nodes[0]);
      items.push(root);
    });
    if (e.shiftKey) {
      engine.download(JSON.stringify(items, undefined, '  '), 'tree.json', 'application/json');
    }
    else {
      engine.clipboard.copy(JSON.stringify(items, undefined, '  ')).then(() => {
        engine.notify('Exported to the clipboard');
      });
    }
  }
};
/* on command */
const command = async (command, e) => {
  const view = views.active();
  if (view) {
    const entries = view.entries();
    if (
      command === 'open-in-new-window' ||
      command === 'open-in-new-incognito-window' ||
      command === 'open-in-new-tab' ||
      command === 'select-next' ||
      command === 'select-previous'
    ) {
      let code = 'Enter';
      if (command === 'select-previous') {
        code = 'ArrowUp';
      }
      else if (command === 'select-next') {
        code = 'ArrowDown';
      }
      e = new KeyboardEvent('keydown', {
        code,
        key: code,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey
      });
      view.simulate(e);
    }
    // shortcuts
    else if (command === 'shortcuts') {
      chrome.tabs.create({
        url: chrome.runtime.getManifest().homepage_url + '#faq4'
      });
    }
    // copy-details
    else if (command === 'copy-details') {
      engine.clipboard.copy(entries.map(o => [o.title, o.url, o.id].filter(a => a).join('\n')).join('\n\n'));
    }
    // copy-title
    else if (command === 'copy-title') {
      engine.clipboard.copy(entries.map(o => o.title).join('\n'));
    }
    // copy-id
    else if (command === 'copy-id') {
      engine.clipboard.copy(entries.map(o => o.id).join('\n'));
    }
    // copy-link
    else if (command === 'copy-link') {
      engine.clipboard.copy(entries.map(o => o.url).filter(a => a).join('\n'));
    }
    // duplicate
    else if (command === 'duplicate') {
      const other = views.left === view ? views.right : views.left;
      const b = other.entries().pop();

      const step = async (node, index, parentId) => {
        const o = {
          parentId,
          title: node.title,
          index
        };
        if (!('children' in node)) {
          o.url = node.url;
        }
        const d = await engine.bookmarks.create(o);

        // directory
        if ('children' in node) {
          for (let n = 0; n < node.children.length; n += 1) {
            step(node.children[n], n, d.id);
          }
        }
      };

      if (b) {
        const parentId = b.openerId || b.parentId;
        try {
          for (let n = 0; n < entries.length; n += 1) {
            const node = await engine.bookmarks.tree(entries[n].id);
            await step(node[0], n + Number(b.index) + 1, parentId);
          }
        }
        catch (e) {
          engine.notify(e);
        }
      }
      views.update();
    }
    // import-tree
    else if (command === 'import-tree') {
      engine.clipboard.read().then(JSON.parse).then(async nodes => {
        if (Array.isArray(nodes) === false) {
          throw Error('This is not a valid JSON array');
        }
        const entry = entries[0];
        const step = async (node, parentId) => {
          const o = {
            parentId
          };
          if (node.index) {
            o.index = Number(node.index) + 1;
          }
          o.title = node.title;
          if (!o.title) {
            throw Error('Bookmark needs title');
          }
          if (node.type === 'FILE') {
            o.url = node.url;
            if (!o.url) {
              throw Error('Bookmark needs URL');
            }
          }
          const n = await engine.bookmarks.create(o);
          if (node.type === 'DIRECTORY') {
            for (const e of node.children) {
              await step(e, n.id);
            }
          }
        };
        let msg = 'Insert the bookmark tree after this node?';
        if (entry.type === 'DIRECTORY') {
          msg = 'Insert the bookmark tree inside this node?';
        }
        if (window.confirm(msg)) {
          for (const node of nodes) {
            if (entry.type === 'FILE') {
              node.index = entry.index;
            }
            await step(node, entry.type === 'FILE' ? entry.parentId : entry.id).then(() => views.update());
          }
        }
      }).catch(engine.notify);
    }
    // export-tree
    else if (command === 'export-tree') {
      await exporting(entries, e);
    }
    else if (command === 'trash') {
      const prefs = await engine.storage.get({
        'ask-before-delete': true,
        'ask-before-directory-delete': true
      });

      if (!prefs['ask-before-delete'] || window.confirm(`Are you sure you want to delete ${entries.length} item${entries.length > 1 ? 's' : ''}?

-> Deleted entries will always be exported to the clipboard.`)) {
        await exporting(entries, e);

        view.navigate('previous');
        for (const entry of entries) {
          await engine.bookmarks.remove(entry.id).catch(e => {
            if (entry.type === 'DIRECTORY') {
              if (!prefs['ask-before-directory-delete'] || window.confirm(`"${entry.title}" directory is not empty. Remove anyway?`)) {
                engine.bookmarks.remove(entry.id, true).catch(engine.notify);
              }
            }
            else {
              engine.notify(e);
            }
          });
        }
        views.update();
      }
    }
    // edit-title
    else if (command === 'edit-title' || command === 'edit-link') {
      const entry = entries[0];
      let o = {};
      if (command === 'edit-title') {
        const title = await engine.user.ask('Edit Title', entry.title);
        o = {title};
        if (title === entry.title || title === '') {
          return;
        }
      }
      else {
        const url = await engine.user.ask('Edit Link', entry.url);
        o = {url};
        if (url === entry.url || url === '') {
          return;
        }
      }
      engine.bookmarks.update(entry.id, o).catch(engine.notify).finally(() => {
        // we need to update both views
        views.update();
      });
    }
    else if (command === 'move-left' || command === 'move-right') {
      const s = command === 'move-left' ? views.right : views.left;
      const d = command === 'move-right' ? views.right : views.left;
      const toBeMoved = s.entries();
      s.navigate('previous');
      for (const entry of toBeMoved) {
        await engine.bookmarks.move(entry.id, {
          parentId: d.id(),
          index: Number(d.entries()[0].index) + 1
        }).catch(engine.notify);
      }
      // update both views
      views.update();
    }
    else if (command === 'root') {
      if (e.shiftKey) {
        engine.storage.set({
          [view.getAttribute('id')]: ''
        }).then(() => {
          view.build(engine.bookmarks.rootID);
        });
      }
      else {
        engine.storage.set({
          'directory-view-1': '',
          'directory-view-2': ''
        }).then(() => location.reload());
      }
    }
    else if (command === 'new-file' || command === 'new-directory') {
      const entry = entries[0];
      const o = {
        parentId: view.id(),
        index: Number(entry.index) + 1
      };
      if (command === 'new-file') {
        const title = ((await engine.user.ask('Title of New Bookmark', entry.title)) || '').trim();
        if (!title) {
          return;
        }
        o.title = title;
        const url = ((await engine.user.ask('URL of New Bookmark', entry.url || 'https://www.example.com')) || '').trim();
        if (!url) {
          return;
        }
        o.url = url;
      }
      else {
        const title = ((await engine.user.ask('Title of New Directory', entry.title)) || '').trim();
        if (title) {
          o.title = title;
        }
        else {
          return;
        }
      }
      engine.bookmarks.create(o).then(() => {
        // update both views
        views.update();
      }, engine.notify);
    }
    else if (command === 'mirror') {
      const next = (...args) => {
        views[view === views.left ? 'right' : 'left'].build(...args);
      };
      if (e.shiftKey) {
        const dir = entries.filter(o => o.type === 'DIRECTORY').shift();
        if (dir) {
          return next(dir.id);
        }
      }
      // on search pane, entries[0].id browse the directory while view.id() browse the search
      next(e.altKey ? entries[0].parentId : view.id(), undefined, entries.map(o => o.id));
    }
    else if (command === 'sync') {
      const el = views.left.entries(false).filter(o => o.type === 'FILE');
      const er = views.right.entries(false).filter(o => o.type === 'FILE');

      const combined = [...el, ...er].map(o => ({
        title: o.title,
        url: o.url
      })).map(o => JSON.stringify(o)).filter((s, i, l) => s && l.indexOf(s) === i).map(JSON.parse);
      // sync panes
      for (const [view, list] of [[views.left, el], [views.right, er]]) {
        const selected = [];
        for (const o of combined) {
          if (list.some(e => e.title === o.title && e.url === o.url) === false) {
            const b = {
              ...o,
              parentId: view.id()
            };
            const node = await engine.bookmarks.create(b);
            selected.push(node.id);
          }
        }
        if (selected.length) {
          view.build(view.id(), undefined, selected);
        }
      }
    }
    else if (command === 'open-folder') {
      const next = (...args) => {
        views[view === views.left ? 'left' : 'right'].build(...args);
      };
      next(entries[0].parentId, undefined, entries.map(o => o.id));
    }
    else if (command === 'search') {
      const id = view.id();
      if (e.query) {
        view.build({
          id,
          query: e.query
        });
      }
    }
    else if (command === 'sort') {
      const entries = view.entries(false);
      // sort based on
      let rules;
      if (e.altKey) {
        rules = await engine.user.ask('Sort By (link, name, date):', 'name, link', [
          'name',
          'name, link',
          'name, link, date',
          'name, date',
          'name, date, link',
          'link',
          'link, name',
          'link, name, date',
          'link, date',
          'link, date, name',
          'date',
          'date, name',
          'date, name, link',
          'date, link',
          'date, link, name'
        ]);
      }
      else {
        rules = 'name';
      }
      rules = rules.split(/\s*,\s*/).filter(a => a === 'link' || a === 'name' || a === 'date');

      if (rules.length === 0) {
        return;
      }

      const sort = list => {
        return list.sort((a, b) => {
          const compare = method => {
            if (method === 'name') {
              return ('' + a.title).localeCompare(b.title + '');
            }
            else if (method === 'link') {
              return ('' + a.url).localeCompare(b.url + '');
            }
            else if (method === 'date') {
              return a.dateAdded - b.dateAdded;
            }
            return 0;
          };
          let w = 0;
          for (const rule of rules) {
            w = compare(rule);
            if (w !== 0) {
              break;
            }
          }
          if (e.shiftKey) {
            return -1 * w;
          }
          return w;
        });
      };
      const directories = sort(entries.filter(e => e.readonly === 'false' && e.type === 'DIRECTORY'));
      const files = sort(entries.filter(e => e.readonly === 'false' && e.type === 'FILE'));

      let index = 0;
      for (const directory of directories) {
        await engine.bookmarks.move(directory.id, {
          parentId: view.id(),
          index
        }).then(() => index += 1).catch(engine.notify);
      }
      for (const file of files) {
        await engine.bookmarks.move(file.id, {
          parentId: view.id(),
          index
        }).then(() => index += 1).catch(engine.notify);
      }
      // update both views
      views.update();
    }
    else if (command === 'first' || command === 'last') {
      view.navigate(command);
    }
    else if (command === 'move-top' || command === 'move-up' || command === 'move-down' || command === 'move-bottom') {
      const t = view.entries(false).length;

      for (let n = 0; n < entries.length; n += 1) {
        let entry = entries[n];
        if (command === 'move-down' || command === 'move-bottom') {
          entry = entries[entries.length - n - 1];
        }
        let index = n;
        if (command === 'move-up') {
          index = Number(entry.index) - 1;
        }
        else if (command === 'move-down') {
          index = Number(entry.index) + 2;
        }
        else if (command === 'move-bottom') {
          index = t - index;
        }
        await engine.bookmarks.move(entry.id, {
          parentId: view.id(),
          index
        }).catch(engine.notify);
      }
      // update both views
      views.update();
    }
    else {
      console.warn('Command is not supported:', command);
    }
  }
};

/* keyboard */
document.addEventListener('keydown', e => {
  // toggle between views by Tab
  if (e.key === 'Tab') {
    const view = views.active(true);
    e.preventDefault();
    if (view) {
      return view.click();
    }
  }
  // move to the left view with arrow key
  else if (e.code === 'ArrowLeft' && e.shiftKey === false && e.ctrlKey === false && e.metaKey === false) {
    views.left.click();
  }
  // move to the left view with arrow key
  else if (e.code === 'ArrowRight' && e.shiftKey === false && e.ctrlKey === false && e.metaKey === false) {
    views.right.click();
  }
  // toggle between views by Ctrl + Digit
  else if (e.code === 'Digit1' && (e.metaKey || e.ctrlKey)) {
    views.left.click();
    e.preventDefault();
  }
  else if (e.code === 'Digit2' && (e.metaKey || e.ctrlKey)) {
    views.right.click();
    e.preventDefault();
  }
  toolsView.command(e, command);
});
// on active view change
views.parent.addEventListener('change', () => {
  views.changed();
});

// select view on tools empty space
toolsView.addEventListener('click', () => views.active().click());

// load user-preferred shortcuts
engine.storage.get({
  'commands-mapping': 'default'
}).then(prefs => {
  const mappings = [prefs['commands-mapping'], 'default'].filter((s, i, l) => s && l.indexOf(s) === i)
    .map(s => 'commands/' + s + '.json');

  Promise.all(mappings.map(s => fetch(s).then(r => r.json()).catch(e => {
    console.warn('cannot find this mapping', s, e);
    return [];
  }))).then(a => a.flat()).then(es => {
    toolsView.load(es);
  });
});

// remember last state
if (args.get('mode') === 'window') {
  const resize = () => {
    engine.storage.set({
      'window.left': window.screenX,
      'window.top': window.screenY,
      'window.width': window.outerWidth,
      'window.height': window.outerHeight
    });
  };
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', resize);
}

// styling
const styling = () => engine.storage.get({
  'font-size': 13,
  'font-family': 'Arial, "Helvetica Neue", Helvetica, sans-serif',
  'user-styles': '',
  'theme': 'default',
  'views': 2,
  'widths': {
    name: 100,
    added: 90,
    modified: 90
  }
}).then(prefs => {
  if (prefs.theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
  else if (prefs.theme === 'light') {
    document.documentElement.classList.remove('dark');
  }
  else {
    if (matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
    else {
      document.documentElement.classList.remove('dark');
    }
  }

  document.body.dataset.views = prefs.views;
  document.getElementById('user-styles').textContent = `
    body {
      font-size: ${prefs['font-size']}px;
      font-family: ${prefs['font-family']};
    }
    ${prefs['user-styles']}
  `;
  views.left.style(prefs.widths);
  views.right.style(prefs.widths);
});
styling();
engine.storage.changed(ps => {
  if (ps['font-size'] || ps['font-family'] || ps['user-styles'] || ps['views'] || ps['widths'] || ps['theme']) {
    styling();
  }
});
matchMedia('(prefers-color-scheme: dark)').addListener(styling);

// messaging
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'instance') {
    response(true);
    chrome.runtime.sendMessage({method: 'activate'});
  }
});
