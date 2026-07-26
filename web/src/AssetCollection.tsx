import {useState} from 'react';
import type {AssetCollection as AssetCollectionData} from './types';
import type {AssetItem} from './types';

interface AssetCollectionProps {
  collection: AssetCollectionData;
  empty: string;
  ambiguous: (count: number) => string;
  busy?: boolean;
  onRename?: (item: AssetItem, stem: string) => void;
  onDelete?: (item: AssetItem) => void;
  currentId?: string | null;
  onSelect?: (item: AssetItem) => void;
}

/**
 * 素材与成果共用的文件列表。可选中、改名和删除都由调用方持有状态与写入边界，
 * 因此展示层不会暗中决定哪个文件是主资产。
 */
export const AssetCollection = ({collection, empty, ambiguous, busy = false, onRename, onDelete, currentId, onSelect}: AssetCollectionProps) => {
  if (collection.state === 'empty') return <p className="hint">{empty}</p>;

  return (
    <div className="asset-collection">
      {collection.state === 'ambiguous' && (
        <p className="hint hint-error">{ambiguous(collection.items.length)}</p>
      )}
      <ul className="asset-list">
        {collection.items.map((item) => <AssetRow key={item.id} item={item} busy={busy} current={item.id === currentId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} />)}
      </ul>
    </div>
  );
};

const AssetRow = ({item, busy, current, onSelect, onRename, onDelete}: {item: AssetItem; busy: boolean; current: boolean; onSelect?: (item: AssetItem) => void; onRename?: (item: AssetItem, stem: string) => void; onDelete?: (item: AssetItem) => void}) => {
  const [editing, setEditing] = useState(false);
  const extensionIndex = item.name.lastIndexOf('.');
  const extension = extensionIndex > 0 ? item.name.slice(extensionIndex) : '';
  const originalStem = extension ? item.name.slice(0, -extension.length) : item.name;
  const [stem, setStem] = useState(originalStem);
  const disabled = busy || item.manageable === false;
  return <li className={current ? 'asset-row asset-row-current' : 'asset-row'}>
    {editing ? <input className="asset-rename-input" value={stem} onChange={(event) => setStem(event.target.value)} aria-label={`重命名 ${item.name}`} /> : onSelect ? <button className="asset-name" onClick={() => onSelect(item)} aria-current={current ? 'true' : undefined}>{item.name}</button> : <span className="asset-name">{item.name}</span>}
    {(onRename || onDelete) && <span className="asset-actions">
      {editing ? <>
        <button className="link-button" disabled={disabled || !stem.trim()} onClick={() => { onRename?.(item, stem); setEditing(false); }}>确认</button>
        <button className="link-button" onClick={() => { setStem(originalStem); setEditing(false); }}>取消</button>
      </> : <>
        <button className="link-button" disabled={disabled || !onRename} title={item.actionHint ?? undefined} onClick={() => setEditing(true)}>改名</button>
        <button className="link-button" disabled={disabled || !onDelete} title={item.actionHint ?? undefined} onClick={() => onDelete?.(item)}>删除</button>
      </>}
    </span>}
  </li>;
};

/** 旧响应缺少 assets 时的只读兼容层；新版响应始终直接使用服务端的规范化集合。 */
export const fallbackAssetCollection = (
  kind: AssetCollectionData['kind'],
  paths: string[],
): AssetCollectionData => ({
  kind,
  origin: kind === 'still' || kind === 'video' ? 'output' : 'source',
  items: paths.map((assetPath) => ({
    id: `${kind}:${assetPath}`,
    kind,
    origin: kind === 'still' || kind === 'video' ? 'output' : 'source',
    name: assetPath.split(/[\\/]/).pop() ?? assetPath,
    path: assetPath,
    preview: kind === 'photo' || kind === 'still' ? {type: 'image', path: assetPath} : null,
    manageable: true,
    actionHint: null,
  })),
  primaryId: paths.length === 1 ? `${kind}:${paths[0]}` : null,
  state: paths.length === 0 ? 'empty' : paths.length === 1 ? 'ready' : 'ambiguous',
});
