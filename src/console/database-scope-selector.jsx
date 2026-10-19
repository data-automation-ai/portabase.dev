import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import {
  DATABASE_COPY_MODES,
  TABLE_COPY_MODES,
  BINARY_COPY_MODES,
  OBJECT_TYPES,
  computeObjectIncludedMb,
  computeDatabaseScopeSummary,
  createDefaultDatabaseScope,
  groupDatabaseObjectsBySchemaAndBucket,
  setSchemaModeInDatabase,
  setBucketModeInDatabase,
} from '../../cloud/runner/database-scope.mjs';

function parseObjectRow(row) {
  const objectType = String(row?.objectType || OBJECT_TYPES.TABLE).toUpperCase();
  const isBinary = objectType === OBJECT_TYPES.BINARY;
  if (isBinary) {
    const bucket = row?.bucket || row?.schema || (typeof row?.name === 'string' && row.name.includes('/') ? row.name.split('/')[0] : 'default');
    const objectName = row?.objectName || (typeof row?.name === 'string' && row.name.startsWith(`${bucket}/`) ? row.name.slice(bucket.length + 1) : row?.name || '');
    return {
      objectType,
      isBinary: true,
      schemaOrBucket: bucket,
      objectName,
      key: row?.name || `${bucket}/${objectName}`,
    };
  }
  const rawName = String(row?.name || '');
  const parts = rawName.split('.');
  const schema = row?.schema || (parts.length > 1 ? parts[0] : 'public');
  const objectName = row?.objectName || (parts.length > 1 ? parts.slice(1).join('.') : rawName);
  return {
    objectType,
    isBinary: false,
    schemaOrBucket: schema,
    objectName,
    key: rawName || `${schema}.${objectName}`,
  };
}

function formatMb(sizeMb) {
  if (typeof sizeMb !== 'number' || Number.isNaN(sizeMb) || sizeMb < 0) return '?? MB';
  if (sizeMb === 0) return '0.00 MB';
  if (sizeMb < 0.01) return '< 0.01 MB';
  return `${sizeMb.toFixed(2)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * Project -> Database -> Spreadsheet Object & Binary Scope Selector
 */
export function DatabaseScopeSelector({
  databases = [],
  onChange = null,
  readOnly = false,
}) {
  const [expandedDbId, setExpandedDbId] = useState(() => {
    const first = Array.isArray(databases) && databases[0]?.id;
    return first || null;
  });
  // Default view shows Schema-level & Bucket-level rows ONLY; at most ONE schema/bucket per DB may be exploded at a time
  const [activeGroupByDb, setActiveGroupByDb] = useState({});
  const [groupRowLimits, setGroupRowLimits] = useState({});
  const [newDbInput, setNewDbInput] = useState('');
  const [newDbName, setNewDbName] = useState('');
  const [showAddDb, setShowAddDb] = useState(false);
  const [newTableInputs, setNewTableInputs] = useState({});
  const [sortConfig, setSortConfig] = useState({});
  const [searchQuery, setSearchQuery] = useState({});
  const [targetCapMb, setTargetCapMb] = useState(1000);
  const [colWidths, setColWidths] = useState({
    type: 78,
    schema: 124,
    name: 230,
    size: 88,
    createdAt: 116,
    updatedAt: 116,
    mode: 196,
    includedMb: 136,
  });

  const handleStartResize = (e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || 100;

    const onMouseMove = (moveEv) => {
      const delta = moveEv.clientX - startX;
      const nextWidth = Math.max(54, startWidth + delta);
      setColWidths((prev) => ({ ...prev, [colKey]: nextWidth }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const dbs = Array.isArray(databases) && databases.length > 0
    ? databases
    : createDefaultDatabaseScope();

  const summary = computeDatabaseScopeSummary(dbs);

  const updateDatabases = (nextDbs) => {
    onChange?.(nextDbs);
  };

  // Strictly ONE schema or bucket exploded at a time per database: opening one automatically closes any other
  const handleToggleGroupExpanded = (dbId, groupKey) => {
    setActiveGroupByDb((prev) => ({
      ...prev,
      [dbId]: prev[dbId] === groupKey ? null : groupKey,
    }));
  };

  const handleCloseActiveGroup = (dbId) => {
    setActiveGroupByDb((prev) => ({
      ...prev,
      [dbId]: null,
    }));
  };

  const handleSetSchemaMode = (dbId, schemaName, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => (db.id === dbId ? setSchemaModeInDatabase(db, schemaName, mode) : db));
    updateDatabases(next);
  };

  const handleSetBucketMode = (dbId, bucketName, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => (db.id === dbId ? setBucketModeInDatabase(db, bucketName, mode) : db));
    updateDatabases(next);
  };

  const handleToggleDbEnabled = (id) => {
    if (readOnly) return;
    const next = dbs.map((db) => (db.id === id ? { ...db, enabled: !db.enabled } : db));
    updateDatabases(next);
  };

  const handleSetDbMode = (id, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => (db.id === id ? { ...db, mode } : db));
    updateDatabases(next);
  };

  const handleSelectAll = (mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => ({
      ...db,
      enabled: true,
      mode,
    }));
    updateDatabases(next);
  };

  const handleSetObjectMode = (dbId, itemKey, isBinary, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => {
      if (db.id !== dbId) return db;
      const updateList = (list = []) =>
        list.map((item) => {
          const parsed = parseObjectRow(item);
          if (parsed.key === itemKey || item.name === itemKey) {
            return { ...item, mode };
          }
          return item;
        });
      return {
        ...db,
        tables: updateList(db.tables || []),
        binaries: Array.isArray(db.binaries) ? updateList(db.binaries) : undefined,
      };
    });
    updateDatabases(next);
  };

  const handleToggleTableStructure = (dbId, itemKey, currentMode) => {
    if (readOnly) return;
    const nextMode = currentMode === TABLE_COPY_MODES.SKIP
      ? TABLE_COPY_MODES.STRUCTURE_ONLY
      : TABLE_COPY_MODES.SKIP;
    handleSetObjectMode(dbId, itemKey, false, nextMode);
  };

  const handleToggleTableData = (dbId, itemKey, currentMode) => {
    if (readOnly) return;
    const nextMode = currentMode === TABLE_COPY_MODES.STRUCTURE_AND_DATA
      ? TABLE_COPY_MODES.STRUCTURE_ONLY
      : TABLE_COPY_MODES.STRUCTURE_AND_DATA;
    handleSetObjectMode(dbId, itemKey, false, nextMode);
  };

  const handleSetAllObjectsMode = (dbId, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => {
      if (db.id !== dbId) return db;
      const mapItem = (item) => {
        const parsed = parseObjectRow(item);
        if (parsed.isBinary) {
          return {
            ...item,
            mode: mode === TABLE_COPY_MODES.SKIP ? BINARY_COPY_MODES.EXCLUDE : BINARY_COPY_MODES.INCLUDE,
          };
        }
        return { ...item, mode };
      };
      return {
        ...db,
        tables: (db.tables || []).map(mapItem),
        binaries: Array.isArray(db.binaries) ? db.binaries.map(mapItem) : undefined,
      };
    });
    updateDatabases(next);
  };

  const handleSetFilteredMode = (dbId, mode, matchingItems = []) => {
    if (readOnly || !Array.isArray(matchingItems) || matchingItems.length === 0) return;
    const matchKeys = new Set(matchingItems.map((item) => parseObjectRow(item).key));
    const next = dbs.map((db) => {
      if (db.id !== dbId) return db;
      const updateItem = (item) => {
        const parsed = parseObjectRow(item);
        if (matchKeys.has(parsed.key) || matchKeys.has(item.name)) {
          if (parsed.isBinary) {
            return {
              ...item,
              mode: mode === TABLE_COPY_MODES.SKIP ? BINARY_COPY_MODES.EXCLUDE : BINARY_COPY_MODES.INCLUDE,
            };
          }
          return { ...item, mode };
        }
        return item;
      };
      return {
        ...db,
        tables: (db.tables || []).map(updateItem),
        binaries: Array.isArray(db.binaries) ? db.binaries.map(updateItem) : undefined,
      };
    });
    updateDatabases(next);
  };

  const handleSort = (dbId, column) => {
    setSortConfig((prev) => {
      const current = prev[dbId] || { column: 'size', direction: 'desc' };
      if (current.column === column) {
        return {
          ...prev,
          [dbId]: {
            column,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          },
        };
      }
      return {
        ...prev,
        [dbId]: {
          column,
          direction: ['size', 'includedMb', 'createdAt', 'updatedAt'].includes(column) ? 'desc' : 'asc',
        },
      };
    });
  };

  const handleAddDatabase = (e) => {
    e?.preventDefault();
    if (readOnly) return;
    const trimmedRef = newDbInput.trim().toLowerCase();
    const cleanRef = trimmedRef.match(/^[a-z0-9]{20}$/i)
      ? trimmedRef
      : trimmedRef.replace(/https?:\/\/([a-z0-9]{20})\.supabase\.co/i, '$1');

    if (!cleanRef) return;

    const friendlyName = newDbName.trim() || `Supabase Project (${cleanRef.slice(0, 6)})`;
    const newDb = {
      id: `db_${cleanRef.slice(0, 8)}_${Date.now().toString(36)}`,
      projectRef: cleanRef,
      projectName: friendlyName,
      name: `${friendlyName} — postgres`,
      estimatedSizeMb: null,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [],
      binaries: [],
    };

    updateDatabases([...dbs, newDb]);
    setNewDbInput('');
    setNewDbName('');
    setShowAddDb(false);
  };

  const handleRemoveDatabase = (id) => {
    if (readOnly || dbs.length <= 1) return;
    updateDatabases(dbs.filter((db) => db.id !== id));
  };

  const handleAddTable = (dbId) => {
    if (readOnly) return;
    const inputVal = (newTableInputs[dbId] || '').trim();
    if (!inputVal) return;

    const formattedName = inputVal.includes('.') ? inputVal : `public.${inputVal}`;
    const next = dbs.map((db) => {
      if (db.id === dbId) {
        const existing = (db.tables || []).find((t) => t.name === formattedName);
        if (existing) return db;
        const newTable = {
          objectType: OBJECT_TYPES.TABLE,
          name: formattedName,
          rowsEstimate: null,
          sizeMb: null,
          createdAt: null,
          updatedAt: null,
          mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA,
        };
        return { ...db, tables: [...(db.tables || []), newTable] };
      }
      return db;
    });

    updateDatabases(next);
    setNewTableInputs({ ...newTableInputs, [dbId]: '' });
  };

  const getAllRowsForDb = (db) => {
    const tables = Array.isArray(db.tables) ? db.tables : [];
    const binaries = Array.isArray(db.binaries) ? db.binaries : [];
    return [...tables, ...binaries].filter((r) => !r?.isEmptyBucket && r?.objectName !== '(empty bucket)');
  };

  const sortChildItems = (items, db) => {
    const { column = 'size', direction = 'desc' } = sortConfig[db.id] || { column: 'size', direction: 'desc' };
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...items].sort((a, b) => {
      const aObj = parseObjectRow(a);
      const bObj = parseObjectRow(b);

      if (column === 'type') {
        const cmp = aObj.objectType.localeCompare(bObj.objectType);
        return cmp !== 0 ? cmp * multiplier : aObj.objectName.localeCompare(bObj.objectName) * multiplier;
      }
      if (column === 'schema') {
        const cmp = aObj.schemaOrBucket.localeCompare(bObj.schemaOrBucket);
        return cmp !== 0 ? cmp * multiplier : aObj.objectName.localeCompare(bObj.objectName) * multiplier;
      }
      if (column === 'name') {
        return aObj.objectName.localeCompare(bObj.objectName) * multiplier;
      }
      if (column === 'size') {
        const aSize = typeof a.sizeMb === 'number' ? a.sizeMb : -1;
        const bSize = typeof b.sizeMb === 'number' ? b.sizeMb : -1;
        return (aSize - bSize) * multiplier;
      }
      if (column === 'createdAt') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() || 0 : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() || 0 : 0;
        return (aTime - bTime) * multiplier;
      }
      if (column === 'updatedAt') {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() || 0 : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() || 0 : 0;
        return (aTime - bTime) * multiplier;
      }
      if (column === 'mode') {
        const rank = {
          [TABLE_COPY_MODES.STRUCTURE_AND_DATA]: 3,
          [BINARY_COPY_MODES.INCLUDE]: 3,
          [TABLE_COPY_MODES.STRUCTURE_ONLY]: 2,
          [TABLE_COPY_MODES.SKIP]: 1,
        };
        return ((rank[a.mode] || 0) - (rank[b.mode] || 0)) * multiplier;
      }
      if (column === 'includedMb') {
        const aInc = computeObjectIncludedMb(a, db.mode);
        const bInc = computeObjectIncludedMb(b, db.mode);
        return (aInc - bInc) * multiplier;
      }
      return 0;
    });
  };

  const getSortedGroupsForDb = (db) => {
    const rawGroups = groupDatabaseObjectsBySchemaAndBucket(db);
    const query = (searchQuery[db.id] || '').trim().toLowerCase();

    const filteredGroups = rawGroups
      .map((grp) => {
        if (!query) {
          return { ...grp, matchingItems: sortChildItems(grp.items, db) };
        }
        const groupMatches =
          grp.objectType.toLowerCase().includes(query) ||
          grp.schemaOrBucket.toLowerCase().includes(query) ||
          grp.objectName.toLowerCase().includes(query);

        const matchingItems = grp.items.filter((row) => {
          const parsed = parseObjectRow(row);
          return (
            parsed.objectType.toLowerCase().includes(query) ||
            parsed.schemaOrBucket.toLowerCase().includes(query) ||
            parsed.objectName.toLowerCase().includes(query) ||
            parsed.key.toLowerCase().includes(query)
          );
        });

        if (!groupMatches && matchingItems.length === 0) return null;
        return {
          ...grp,
          matchingItems: sortChildItems(matchingItems.length > 0 ? matchingItems : grp.items, db),
        };
      })
      .filter(Boolean);

    const { column = 'size', direction = 'desc' } = sortConfig[db.id] || { column: 'size', direction: 'desc' };
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filteredGroups].sort((a, b) => {
      if (column === 'type') {
        const cmp = a.objectType.localeCompare(b.objectType);
        return cmp !== 0 ? cmp * multiplier : a.schemaOrBucket.localeCompare(b.schemaOrBucket) * multiplier;
      }
      if (column === 'schema') {
        return a.schemaOrBucket.localeCompare(b.schemaOrBucket) * multiplier;
      }
      if (column === 'name') {
        return (a.objectCount - b.objectCount) * multiplier;
      }
      if (column === 'size') {
        return ((a.sizeMb || 0) - (b.sizeMb || 0)) * multiplier;
      }
      if (column === 'createdAt') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() || 0 : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() || 0 : 0;
        return (aTime - bTime) * multiplier;
      }
      if (column === 'updatedAt') {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() || 0 : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() || 0 : 0;
        return (aTime - bTime) * multiplier;
      }
      if (column === 'mode') {
        const rank = {
          [TABLE_COPY_MODES.STRUCTURE_AND_DATA]: 3,
          [BINARY_COPY_MODES.INCLUDE]: 3,
          mixed: 2.5,
          [TABLE_COPY_MODES.STRUCTURE_ONLY]: 2,
          [TABLE_COPY_MODES.SKIP]: 1,
        };
        return ((rank[a.mode] || 0) - (rank[b.mode] || 0)) * multiplier;
      }
      if (column === 'includedMb') {
        return ((a.includedMb || 0) - (b.includedMb || 0)) * multiplier;
      }
      return 0;
    });
  };

  const renderSortHeader = (dbId, column, label, align = 'left') => {
    const current = sortConfig[dbId] || { column: 'size', direction: 'desc' };
    const isActive = current.column === column;
    const arrow = isActive ? (current.direction === 'asc' ? ' ▲' : ' ▼') : ' ↕';
    const widthPx = colWidths[column] || 100;

    return (
      <th
        onClick={() => handleSort(dbId, column)}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          width: `${widthPx}px`,
          minWidth: `${widthPx}px`,
          maxWidth: `${widthPx}px`,
          textAlign: align,
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: '8.5pt',
          fontWeight: 700,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          color: isActive ? '#0f172a' : '#334155',
          background: isActive ? '#e2e8f0' : '#f1f5f9',
          borderBottom: '1px solid #94a3b8',
          borderRight: '1px solid #cbd5e1',
          padding: '3px 6px',
          height: '22px',
          lineHeight: '1.15',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={`Click to sort by ${label} · Drag right border to resize`}
      >
        <span>{label}</span>
        <span style={{ fontSize: '8pt', opacity: isActive ? 1 : 0.45, marginLeft: '3px' }}>{arrow}</span>
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => handleStartResize(e, column)}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '5px',
            cursor: 'col-resize',
            zIndex: 3,
          }}
          title="Drag to resize column"
        />
      </th>
    );
  };

  return (
    <div
      className="pb-scope-selector"
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '10px',
        padding: '18px',
        color: '#f0f6fc',
        overflowWrap: 'break-word',
        minWidth: 0,
      }}
      aria-label="Multi-database and table copy-mode selector"
    >
      {/* Top Quick Actions Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '16px',
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f0f6fc' }}>
            Accessible Supabase Projects &amp; Databases
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#8b949e' }}>
            Click any database to open the sortable object &amp; binary storage spreadsheet.
          </p>
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="pb-btn pb-btn-sm"
              onClick={() => handleSelectAll(DATABASE_COPY_MODES.STRUCTURE_AND_DATA)}
              style={{ fontSize: '12px', padding: '5px 10px' }}
            >
              Select All (Structure + Data)
            </button>
            <button
              type="button"
              className="pb-btn pb-btn-sm"
              onClick={() => handleSelectAll(DATABASE_COPY_MODES.STRUCTURE_ONLY)}
              style={{ fontSize: '12px', padding: '5px 10px' }}
            >
              All Structure Only ⚡
            </button>
            <button
              type="button"
              className="pb-btn pb-btn-sm pb-btn-primary"
              onClick={() => setShowAddDb((v) => !v)}
              style={{ fontSize: '12px', padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <Icon name="plus" size={12} /> Add Project / Database
            </button>
          </div>
        )}
      </div>

      {/* Add Database Form Collapsible */}
      {showAddDb && !readOnly && (
        <form
          onSubmit={handleAddDatabase}
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '8px',
            padding: '14px',
            marginBottom: '16px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#3ecf8e' }}>
              Add Additional Supabase Project / Database
            </span>
            <button
              type="button"
              className="pb-btn pb-btn-sm pb-btn-ghost"
              onClick={() => setShowAddDb(false)}
              style={{ padding: '2px 6px' }}
            >
              Cancel
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                Supabase Project Ref or URL (20 chars)
              </label>
              <input
                type="text"
                className="pb-input"
                placeholder="e.g. abcdefghijklmnopqrst"
                value={newDbInput}
                onChange={(e) => setNewDbInput(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                Project / Database Name (Optional)
              </label>
              <input
                type="text"
                className="pb-input"
                placeholder="e.g. Production App"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                style={{ width: '100%', fontSize: '12px' }}
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              className="pb-btn pb-btn-sm pb-btn-primary"
              disabled={!newDbInput.trim()}
              style={{ padding: '6px 14px' }}
            >
              Add to Export Scope
            </button>
          </div>
        </form>
      )}

      {/* Project -> Database Cards List */}
      <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
        {dbs.map((db) => {
          const isExpanded = expandedDbId === db.id;
          const isStructureOnly = db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY;
          const allObjects = getAllRowsForDb(db);
          const sortedGroups = getSortedGroupsForDb(db);
          const activeGroupKey = activeGroupByDb[db.id] || null;
          const activeGroup = activeGroupKey ? sortedGroups.find((g) => g.groupKey === activeGroupKey) : null;
          const dbMetrics = summary.perDatabase?.[db.id] || {};
          const skippedCount = allObjects.filter((t) => t.mode === TABLE_COPY_MODES.SKIP || t.mode === 'exclude').length;
          const structOnlyTableCount = allObjects.filter((t) => t.mode === TABLE_COPY_MODES.STRUCTURE_ONLY).length;
          const fullCount = allObjects.length - structOnlyTableCount - skippedCount;

          // Running stacked MB accumulator across Schema & Bucket groups
          let runningStackedMb = 0;

          return (
            <div
              key={db.id}
              style={{
                background: db.enabled ? '#161b22' : '#0e1217',
                border: db.enabled ? '1px solid #30363d' : '1px solid #21262d',
                borderRadius: '8px',
                padding: '14px 16px',
                opacity: db.enabled ? 1 : 0.65,
                transition: 'all 0.15s ease',
              }}
            >
              {/* Project Banner Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#8b949e',
                marginBottom: '6px',
                paddingBottom: '6px',
                borderBottom: '1px dashed #21262d',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: '#58a6ff', fontWeight: 700 }}>
                    PROJECT: {db.projectName || db.name || 'Supabase Project'}
                  </span>
                  {db.projectRef && (
                    <span className="pb-badge" style={{ fontFamily: 'monospace', fontSize: '11px', background: '#21262d' }}>
                      {db.projectRef}
                    </span>
                  )}
                  {db.region && (
                    <span style={{ color: '#8b949e' }}>({db.region})</span>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#c9d1d9' }}>
                  Project DB + Storage Total:{' '}
                  <span style={{ color: '#3ecf8e' }}>
                    {typeof dbMetrics.totalSourceMb === 'number'
                      ? `${dbMetrics.totalSourceMb.toFixed(2)} MB`
                      : (typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb >= 0 ? `~${db.estimatedSizeMb} MB` : '?? MB')}
                  </span>
                  {typeof dbMetrics.includedMb === 'number' && (
                    <span style={{ marginLeft: '10px', color: '#7ee787' }}>
                      (Selected: {dbMetrics.includedMb.toFixed(2)} MB)
                    </span>
                  )}
                </div>
              </div>

              {/* Database Row underneath Project */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(db.enabled)}
                    onChange={() => handleToggleDbEnabled(db.id)}
                    disabled={readOnly}
                    style={{ cursor: readOnly ? 'default' : 'pointer', width: '16px', height: '16px' }}
                    aria-label={`Include database ${db.name || db.projectRef} in target`}
                  />
                  <div
                    onClick={() => setExpandedDbId(isExpanded ? null : db.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px', color: '#f0f6fc', textDecoration: 'underline', textDecorationColor: '#30363d' }}>
                        🗄️ {db.databaseName || db.name || 'postgres'}
                      </strong>
                      <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                        {typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb >= 0
                          ? `~${db.estimatedSizeMb} MB`
                          : '?? MB'}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      {!db.enabled
                        ? 'Database deselected from backup and restore target'
                        : isStructureOnly
                          ? '⚡ Structure Only: Schemas, tables, DDL & RLS (0 table rows saved)'
                          : `${sortedGroups.filter((g) => !g.isBinary).length} schemas · ${sortedGroups.filter((g) => g.isBinary).length} buckets · ${allObjects.length} total objects (${fullCount} included, ${structOnlyTableCount} structure-only, ${skippedCount} excluded)`}
                    </div>
                  </div>
                </div>

                {/* 2-Pill Segmented Database Mode Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      background: '#0d1117',
                      padding: '3px',
                      borderRadius: '6px',
                      border: '1px solid #30363d',
                    }}
                    role="group"
                    aria-label="Database copy mode"
                  >
                    <button
                      type="button"
                      onClick={() => handleSetDbMode(db.id, DATABASE_COPY_MODES.STRUCTURE_AND_DATA)}
                      disabled={readOnly || !db.enabled}
                      style={{
                        padding: '5px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: db.enabled && !readOnly ? 'pointer' : 'default',
                        background: !isStructureOnly ? '#1f6feb' : 'transparent',
                        color: !isStructureOnly ? '#ffffff' : '#8b949e',
                      }}
                    >
                      Structure + Data + Objects
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetDbMode(db.id, DATABASE_COPY_MODES.STRUCTURE_ONLY)}
                      disabled={readOnly || !db.enabled}
                      style={{
                        padding: '5px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: db.enabled && !readOnly ? 'pointer' : 'default',
                        background: isStructureOnly ? '#238636' : 'transparent',
                        color: isStructureOnly ? '#ffffff' : '#8b949e',
                      }}
                    >
                      Structure Only ⚡
                    </button>
                  </div>

                  {dbs.length > 1 && !readOnly && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDatabase(db.id)}
                      className="pb-btn pb-btn-sm pb-btn-ghost"
                      style={{ color: '#f85149', padding: '4px 8px' }}
                      title="Remove database"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>

              {/* Database Objects Spreadsheet Drawer Toggle */}
              {db.enabled && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #21262d', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedDbId(isExpanded ? null : db.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#58a6ff',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontWeight: 600,
                      }}
                    >
                      <span>{isExpanded ? '▴ Hide spreadsheet of schemas, buckets & objects' : '▾ Click into database schemas & buckets (Spreadsheet View)'}</span>
                      <span className="pb-badge" style={{ fontSize: '11px', background: '#21262d', color: '#c9d1d9' }}>
                        {sortedGroups.length} schemas/buckets · {allObjects.length} objects
                      </span>
                    </button>

                    <div style={{ fontSize: '11px', color: '#8b949e' }}>
                      {structOnlyTableCount > 0 && <span style={{ color: '#7ee787', marginRight: '8px' }}>⚡ {structOnlyTableCount} Structure Only</span>}
                      {skippedCount > 0 && <span style={{ color: '#f85149', marginRight: '8px' }}>✕ {skippedCount} Excluded</span>}
                      <span>✓ {fullCount} Included</span>
                    </div>
                  </div>

                  {/* Expanded Spreadsheet-Like View */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: '12px',
                        background: '#0d1117',
                        borderRadius: '8px',
                        border: '1px solid #30363d',
                        padding: '12px',
                      }}
                    >
                      {/* Spreadsheet Header Toolbar: Search, Expand/Collapse Schemas & Buckets, and Bulk Action Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
                          <input
                            type="text"
                            placeholder="Filter schemas, buckets, or individual object names..."
                            value={searchQuery[db.id] || ''}
                            onChange={(e) => setSearchQuery({ ...searchQuery, [db.id]: e.target.value })}
                            style={{
                              width: '100%',
                              maxWidth: '340px',
                              background: '#161b22',
                              border: '1px solid #30363d',
                              borderRadius: '6px',
                              padding: '6px 10px',
                              color: '#f0f6fc',
                              fontSize: '12px',
                            }}
                          />
                          {searchQuery[db.id] && (
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm pb-btn-ghost"
                              onClick={() => setSearchQuery({ ...searchQuery, [db.id]: '' })}
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                            >
                              Clear
                            </button>
                          )}
                          {activeGroup ? (
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm pb-btn-primary"
                              onClick={() => handleCloseActiveGroup(db.id)}
                              style={{ fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                            >
                              ▴ Done Picking / Close &ldquo;{activeGroup.schemaOrBucket}&rdquo;
                            </button>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#8b949e', whiteSpace: 'nowrap' }}>
                              Click one Schema or Bucket row to explode, pick its records, then close
                            </span>
                          )}
                        </div>

                        {!readOnly && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '11px', color: '#8b949e', marginRight: '2px' }}>Bulk:</span>
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm"
                              onClick={() => handleSetAllObjectsMode(db.id, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                              style={{ fontSize: '11px', padding: '3px 8px', background: '#1f6feb', color: '#fff' }}
                            >
                              All Full / Include
                            </button>
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm"
                              onClick={() => handleSetAllObjectsMode(db.id, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                              style={{ fontSize: '11px', padding: '3px 8px', background: '#238636', color: '#fff' }}
                            >
                              All Structure Only ⚡
                            </button>
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm pb-btn-ghost"
                              onClick={() => handleSetAllObjectsMode(db.id, TABLE_COPY_MODES.SKIP)}
                              style={{ fontSize: '11px', padding: '3px 8px', color: '#f85149' }}
                            >
                              Exclude All
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Dense 8.5pt Spreadsheet Grid (Default: Schema & Bucket rows only; click ONE Schema/Bucket at a time to explode, pick records, and close) */}
                      <div
                        style={{
                          maxHeight: '460px',
                          overflowY: 'auto',
                          overflowX: 'auto',
                          border: '1px solid #94a3b8',
                          background: '#ffffff',
                        }}
                      >
                        <table
                          style={{
                            borderCollapse: 'collapse',
                            tableLayout: 'fixed',
                            width: `${Object.values(colWidths).reduce((a, b) => a + b, 0)}px`,
                            minWidth: '100%',
                            fontSize: '8.5pt',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            background: '#ffffff',
                            color: '#0f172a',
                          }}
                        >
                          <thead>
                            <tr>
                              {renderSortHeader(db.id, 'type', 'Object Type', 'left')}
                              {renderSortHeader(db.id, 'schema', 'Schema / Bucket', 'left')}
                              {renderSortHeader(db.id, 'name', 'Object Name', 'left')}
                              {renderSortHeader(db.id, 'size', 'Size (MB)', 'right')}
                              {renderSortHeader(db.id, 'createdAt', 'Date Created', 'left')}
                              {renderSortHeader(db.id, 'updatedAt', 'Last Updated', 'left')}
                              {renderSortHeader(db.id, 'mode', 'Operation Switch', 'center')}
                              {renderSortHeader(db.id, 'includedMb', 'Stacked MB', 'right')}
                            </tr>
                          </thead>
                          <tbody>
                            {sortedGroups.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={8}
                                  style={{
                                    textAlign: 'center',
                                    padding: '12px',
                                    color: '#475569',
                                    fontSize: '8.5pt',
                                    background: '#ffffff',
                                  }}
                                >
                                  {allObjects.length === 0
                                    ? 'No schemas, buckets, or objects discovered yet for this database. Connect via OAuth inside the runner or add custom objects below.'
                                    : 'No schemas, buckets, or objects match the search filter.'}
                                </td>
                              </tr>
                            ) : (
                              sortedGroups.map((grp, grpIdx) => {
                                const isGroupExpanded = activeGroupKey === grp.groupKey;
                                const isBucket = grp.isBinary;
                                const grpMode = grp.mode;
                                const isGrpSkip = grpMode === TABLE_COPY_MODES.SKIP || grpMode === 'exclude';
                                const isGrpStruct = !isBucket && grpMode === TABLE_COPY_MODES.STRUCTURE_ONLY;
                                const isGrpFull = !isBucket && grpMode === TABLE_COPY_MODES.STRUCTURE_AND_DATA;
                                const isGrpInclude = isBucket && grpMode === BINARY_COPY_MODES.INCLUDE;

                                const grpIncludedMb = grp.includedMb || 0;
                                runningStackedMb = Number((runningStackedMb + grpIncludedMb).toFixed(2));
                                const stackedAfterGroup = runningStackedMb;

                                const grpBg = isGrpSkip
                                  ? '#fef2f2'
                                  : isGroupExpanded
                                    ? '#dbeafe'
                                    : grpIdx % 2 === 0
                                      ? '#f8fafc'
                                      : '#f1f5f9';

                                const grpCellStyle = {
                                  fontSize: '8.5pt',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                  padding: '1px 6px',
                                  height: '22px',
                                  lineHeight: '1.15',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  borderBottom: '1px solid #94a3b8',
                                  borderRight: '1px solid #cbd5e1',
                                  background: grpBg,
                                  color: isGrpSkip ? '#94a3b8' : '#0f172a',
                                  verticalAlign: 'middle',
                                };

                                const childItems = grp.matchingItems || [];
                                const limitKey = `${db.id}:${grp.groupKey}`;
                                const rowLimit = groupRowLimits[limitKey] || 500;
                                const visibleChildren = isGroupExpanded ? childItems.slice(0, rowLimit) : [];
                                const remainingChildren = childItems.length - visibleChildren.length;
                                let childRunningMb = 0;

                                return (
                                  <React.Fragment key={grp.groupKey}>
                                    {/* Schema-Level or Bucket-Level Summary Row (Default View) */}
                                    <tr
                                      style={{ height: '22px', cursor: 'pointer' }}
                                      onClick={() => handleToggleGroupExpanded(db.id, grp.groupKey)}
                                      title={`Click to ${isGroupExpanded ? 'close' : 'explode'} ${grp.objectType} "${grp.schemaOrBucket}" (${grp.objectCount} objects)`}
                                    >
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.type}px`,
                                          fontWeight: 700,
                                          color: isGrpSkip ? '#94a3b8' : isBucket ? '#9a3412' : '#0f172a',
                                        }}
                                      >
                                        {grp.objectType}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.schema}px`,
                                          fontWeight: 700,
                                          color: isGrpSkip ? '#94a3b8' : isBucket ? '#7c2d12' : '#1e3a8a',
                                        }}
                                        title={grp.schemaOrBucket}
                                      >
                                        {isGroupExpanded ? '▼ ' : '▶ '}
                                        {grp.schemaOrBucket}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.name}px`,
                                          fontWeight: 700,
                                          color: isGrpSkip ? '#94a3b8' : '#0f172a',
                                        }}
                                        title={`${grp.objectName} — click to ${isGroupExpanded ? 'close' : 'explode'}`}
                                      >
                                        {grp.objectName}
                                        {isGroupExpanded && (
                                          <span style={{ marginLeft: '6px', color: '#1d4ed8', fontWeight: 700 }}>
                                            [▴ Done / Close]
                                          </span>
                                        )}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.size}px`,
                                          textAlign: 'right',
                                          fontWeight: 700,
                                        }}
                                      >
                                        {formatMb(grp.sizeMb)}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.createdAt}px`,
                                          color: '#475569',
                                        }}
                                      >
                                        {formatDate(grp.createdAt)}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.updatedAt}px`,
                                          color: '#475569',
                                        }}
                                      >
                                        {formatDate(grp.updatedAt)}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.mode}px`,
                                          textAlign: 'center',
                                          padding: '1px 3px',
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {isBucket ? (
                                          <div
                                            style={{
                                              display: 'inline-flex',
                                              border: '1px solid #94a3b8',
                                              background: '#ffffff',
                                            }}
                                            role="group"
                                            aria-label={`Bucket export mode for ${grp.schemaOrBucket}`}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => handleSetBucketMode(db.id, grp.schemaOrBucket, BINARY_COPY_MODES.EXCLUDE)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '0 6px',
                                                height: '16px',
                                                fontSize: '8pt',
                                                fontFamily: 'inherit',
                                                fontWeight: isGrpSkip ? 700 : 400,
                                                border: 'none',
                                                borderRight: '1px solid #cbd5e1',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isGrpSkip ? '#dc2626' : 'transparent',
                                                color: isGrpSkip ? '#ffffff' : '#334155',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={`Exclude entire bucket "${grp.schemaOrBucket}"`}
                                            >
                                              Exclude
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetBucketMode(db.id, grp.schemaOrBucket, BINARY_COPY_MODES.INCLUDE)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '0 6px',
                                                height: '16px',
                                                fontSize: '8pt',
                                                fontFamily: 'inherit',
                                                fontWeight: isGrpInclude ? 700 : 400,
                                                border: 'none',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isGrpInclude ? '#1d4ed8' : 'transparent',
                                                color: isGrpInclude ? '#ffffff' : '#334155',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={`Include entire bucket "${grp.schemaOrBucket}"`}
                                            >
                                              Include{grpMode === 'mixed' ? '*' : ''}
                                            </button>
                                          </div>
                                        ) : (
                                          <div
                                            style={{
                                              display: 'inline-flex',
                                              border: '1px solid #94a3b8',
                                              background: '#ffffff',
                                            }}
                                            role="group"
                                            aria-label={`Schema export mode for ${grp.schemaOrBucket}`}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => handleSetSchemaMode(db.id, grp.schemaOrBucket, TABLE_COPY_MODES.SKIP)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '0 5px',
                                                height: '16px',
                                                fontSize: '8pt',
                                                fontFamily: 'inherit',
                                                fontWeight: isGrpSkip ? 700 : 400,
                                                border: 'none',
                                                borderRight: '1px solid #cbd5e1',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isGrpSkip ? '#dc2626' : 'transparent',
                                                color: isGrpSkip ? '#ffffff' : '#334155',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={`Exclude entire schema "${grp.schemaOrBucket}"`}
                                            >
                                              Exclude
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetSchemaMode(db.id, grp.schemaOrBucket, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '0 5px',
                                                height: '16px',
                                                fontSize: '8pt',
                                                fontFamily: 'inherit',
                                                fontWeight: isGrpStruct ? 700 : 400,
                                                border: 'none',
                                                borderRight: '1px solid #cbd5e1',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isGrpStruct ? '#15803d' : 'transparent',
                                                color: isGrpStruct ? '#ffffff' : '#334155',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={`Include structure only for entire schema "${grp.schemaOrBucket}"`}
                                            >
                                              Struct
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetSchemaMode(db.id, grp.schemaOrBucket, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '0 5px',
                                                height: '16px',
                                                fontSize: '8pt',
                                                fontFamily: 'inherit',
                                                fontWeight: isGrpFull ? 700 : 400,
                                                border: 'none',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isGrpFull ? '#1d4ed8' : 'transparent',
                                                color: isGrpFull ? '#ffffff' : '#334155',
                                                whiteSpace: 'nowrap',
                                              }}
                                              title={`Include structure + data for entire schema "${grp.schemaOrBucket}"`}
                                            >
                                              Struct+Data{grpMode === 'mixed' ? '*' : ''}
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                      <td
                                        style={{
                                          ...grpCellStyle,
                                          width: `${colWidths.includedMb}px`,
                                          textAlign: 'right',
                                          fontWeight: 700,
                                          color: isGrpSkip ? '#94a3b8' : '#0f766e',
                                        }}
                                        title={`Group: +${grpIncludedMb.toFixed(2)} MB | Running Stacked Sum: ${stackedAfterGroup.toFixed(2)} MB`}
                                      >
                                        +{grpIncludedMb.toFixed(2)} (Σ {stackedAfterGroup.toFixed(2)})
                                      </td>
                                    </tr>

                                    {/* Expanded Child Objects inside this Schema or Bucket */}
                                    {visibleChildren.map((item, rowIdx) => {
                                      const parsed = parseObjectRow(item);
                                      const isBinary = parsed.isBinary;
                                      const mode = item.mode || (isBinary ? BINARY_COPY_MODES.INCLUDE : TABLE_COPY_MODES.STRUCTURE_AND_DATA);
                                      const isSkip = mode === TABLE_COPY_MODES.SKIP || mode === 'exclude';
                                      const isStructureOnlyRow = !isBinary && mode === TABLE_COPY_MODES.STRUCTURE_ONLY;
                                      const isFull = !isSkip && !isStructureOnlyRow;

                                      const rowIncludedMb = computeObjectIncludedMb(item, db.mode);
                                      childRunningMb = Number((childRunningMb + rowIncludedMb).toFixed(2));

                                      const rowBg = isSkip
                                        ? '#fef2f2'
                                        : rowIdx % 2 === 0
                                          ? '#ffffff'
                                          : '#f8fafc';

                                      const baseCellStyle = {
                                        fontSize: '8.5pt',
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                        padding: '1px 6px',
                                        height: '21px',
                                        lineHeight: '1.15',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        borderBottom: '1px solid #cbd5e1',
                                        borderRight: '1px solid #cbd5e1',
                                        background: rowBg,
                                        color: isSkip ? '#94a3b8' : '#0f172a',
                                        verticalAlign: 'middle',
                                      };

                                      return (
                                        <tr key={parsed.key} style={{ height: '21px' }}>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.type}px`,
                                              paddingLeft: '14px',
                                              fontWeight: 600,
                                              color: isSkip ? '#94a3b8' : isBinary ? '#9a3412' : '#334155',
                                            }}
                                            title={parsed.objectType}
                                          >
                                            {parsed.objectType}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.schema}px`,
                                              paddingLeft: '14px',
                                              color: isSkip ? '#94a3b8' : '#64748b',
                                            }}
                                            title={parsed.schemaOrBucket}
                                          >
                                            └ {parsed.schemaOrBucket}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.name}px`,
                                              fontWeight: 600,
                                              color: isSkip ? '#94a3b8' : '#0f172a',
                                            }}
                                            title={parsed.objectName}
                                          >
                                            {parsed.objectName}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.size}px`,
                                              textAlign: 'right',
                                            }}
                                          >
                                            {formatMb(item.sizeMb)}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.createdAt}px`,
                                              color: '#475569',
                                            }}
                                            title={formatDate(item.createdAt)}
                                          >
                                            {formatDate(item.createdAt)}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.updatedAt}px`,
                                              color: '#475569',
                                            }}
                                            title={formatDate(item.updatedAt)}
                                          >
                                            {formatDate(item.updatedAt)}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.mode}px`,
                                              textAlign: 'center',
                                              padding: '1px 3px',
                                            }}
                                          >
                                            {isBinary ? (
                                              <div
                                                style={{
                                                  display: 'inline-flex',
                                                  border: '1px solid #94a3b8',
                                                  background: '#f1f5f9',
                                                }}
                                                role="group"
                                                aria-label={`Binary export mode for ${parsed.key}`}
                                              >
                                                <button
                                                  type="button"
                                                  onClick={() => handleSetObjectMode(db.id, parsed.key, true, BINARY_COPY_MODES.EXCLUDE)}
                                                  disabled={readOnly}
                                                  style={{
                                                    padding: '0 6px',
                                                    height: '16px',
                                                    fontSize: '8pt',
                                                    fontFamily: 'inherit',
                                                    fontWeight: isSkip ? 700 : 400,
                                                    border: 'none',
                                                    borderRight: '1px solid #cbd5e1',
                                                    cursor: readOnly ? 'default' : 'pointer',
                                                    background: isSkip ? '#dc2626' : 'transparent',
                                                    color: isSkip ? '#ffffff' : '#334155',
                                                    whiteSpace: 'nowrap',
                                                  }}
                                                >
                                                  Exclude
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleSetObjectMode(db.id, parsed.key, true, BINARY_COPY_MODES.INCLUDE)}
                                                  disabled={readOnly}
                                                  style={{
                                                    padding: '0 6px',
                                                    height: '16px',
                                                    fontSize: '8pt',
                                                    fontFamily: 'inherit',
                                                    fontWeight: !isSkip ? 700 : 400,
                                                    border: 'none',
                                                    cursor: readOnly ? 'default' : 'pointer',
                                                    background: !isSkip ? '#1d4ed8' : 'transparent',
                                                    color: !isSkip ? '#ffffff' : '#334155',
                                                    whiteSpace: 'nowrap',
                                                  }}
                                                >
                                                  Include
                                                </button>
                                              </div>
                                            ) : (
                                              <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                <input
                                                  type="checkbox"
                                                  checked={!isSkip}
                                                  onChange={() => handleToggleTableStructure(db.id, parsed.key, mode)}
                                                  disabled={readOnly}
                                                  style={{ display: 'none' }}
                                                  aria-label={`Include structure for ${parsed.key}`}
                                                />
                                                <input
                                                  type="checkbox"
                                                  checked={isFull}
                                                  disabled={isSkip || readOnly}
                                                  onChange={() => handleToggleTableData(db.id, parsed.key, mode)}
                                                  style={{ display: 'none' }}
                                                  aria-label={`Include data for ${parsed.key}`}
                                                />
                                                <div
                                                  style={{
                                                    display: 'inline-flex',
                                                    border: '1px solid #94a3b8',
                                                    background: '#f1f5f9',
                                                  }}
                                                  role="group"
                                                  aria-label={`Inclusion mode for ${parsed.key}`}
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() => handleSetObjectMode(db.id, parsed.key, false, TABLE_COPY_MODES.SKIP)}
                                                    disabled={readOnly}
                                                    style={{
                                                      padding: '0 5px',
                                                      height: '16px',
                                                      fontSize: '8pt',
                                                      fontFamily: 'inherit',
                                                      fontWeight: isSkip ? 700 : 400,
                                                      border: 'none',
                                                      borderRight: '1px solid #cbd5e1',
                                                      cursor: readOnly ? 'default' : 'pointer',
                                                      background: isSkip ? '#dc2626' : 'transparent',
                                                      color: isSkip ? '#ffffff' : '#334155',
                                                      whiteSpace: 'nowrap',
                                                    }}
                                                    title="Exclude object completely"
                                                  >
                                                    Exclude
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleSetObjectMode(db.id, parsed.key, false, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                                                    disabled={readOnly}
                                                    style={{
                                                      padding: '0 5px',
                                                      height: '16px',
                                                      fontSize: '8pt',
                                                      fontFamily: 'inherit',
                                                      fontWeight: isStructureOnlyRow ? 700 : 400,
                                                      border: 'none',
                                                      borderRight: '1px solid #cbd5e1',
                                                      cursor: readOnly ? 'default' : 'pointer',
                                                      background: isStructureOnlyRow ? '#15803d' : 'transparent',
                                                      color: isStructureOnlyRow ? '#ffffff' : '#334155',
                                                      whiteSpace: 'nowrap',
                                                    }}
                                                    title="Include structure only (DDL schema, 0 row data)"
                                                  >
                                                    Struct
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleSetObjectMode(db.id, parsed.key, false, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                                                    disabled={readOnly}
                                                    style={{
                                                      padding: '0 5px',
                                                      height: '16px',
                                                      fontSize: '8pt',
                                                      fontFamily: 'inherit',
                                                      fontWeight: isFull ? 700 : 400,
                                                      border: 'none',
                                                      cursor: readOnly ? 'default' : 'pointer',
                                                      background: isFull ? '#1d4ed8' : 'transparent',
                                                      color: isFull ? '#ffffff' : '#334155',
                                                      whiteSpace: 'nowrap',
                                                    }}
                                                    title="Include structure and data"
                                                  >
                                                    Struct+Data
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </td>
                                          <td
                                            style={{
                                              ...baseCellStyle,
                                              width: `${colWidths.includedMb}px`,
                                              textAlign: 'right',
                                              fontWeight: 600,
                                              color: isSkip ? '#94a3b8' : '#0f766e',
                                            }}
                                            title={`Object: +${rowIncludedMb.toFixed(2)} MB | Group Stacked: ${childRunningMb.toFixed(2)} MB`}
                                          >
                                            +{rowIncludedMb.toFixed(2)} (Σ {childRunningMb.toFixed(2)})
                                          </td>
                                        </tr>
                                      );
                                    })}

                                    {/* Load More / Show All Row when an expanded Schema or Bucket has >500 objects */}
                                    {isGroupExpanded && remainingChildren > 0 && (
                                      <tr style={{ height: '22px', background: '#f1f5f9' }}>
                                        <td
                                          colSpan={8}
                                          style={{
                                            fontSize: '8.5pt',
                                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                            padding: '2px 12px',
                                            borderBottom: '1px solid #94a3b8',
                                            color: '#1e293b',
                                          }}
                                        >
                                          Showing {visibleChildren.length} of {childItems.length} objects in {grp.objectType.toLowerCase()} &ldquo;{grp.schemaOrBucket}&rdquo; &mdash;{' '}
                                          <button
                                            type="button"
                                            onClick={() => setGroupRowLimits((prev) => ({ ...prev, [limitKey]: rowLimit + 1000 }))}
                                            style={{
                                              border: '1px solid #94a3b8',
                                              background: '#ffffff',
                                              color: '#1d4ed8',
                                              fontSize: '8pt',
                                              fontFamily: 'inherit',
                                              fontWeight: 700,
                                              padding: '0 6px',
                                              marginRight: '6px',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Show +1,000 more
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setGroupRowLimits((prev) => ({ ...prev, [limitKey]: childItems.length }))}
                                            style={{
                                              border: '1px solid #94a3b8',
                                              background: '#ffffff',
                                              color: '#0f172a',
                                              fontSize: '8pt',
                                              fontFamily: 'inherit',
                                              fontWeight: 700,
                                              padding: '0 6px',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Show all {childItems.length} objects
                                          </button>
                                        </td>
                                      </tr>
                                    )}

                                    {/* Close Exploded Schema / Bucket Footer Row */}
                                    {isGroupExpanded && (
                                      <tr
                                        style={{ height: '22px', background: '#dbeafe', cursor: 'pointer' }}
                                        onClick={() => handleCloseActiveGroup(db.id)}
                                        title={`Done picking records in ${grp.objectType} "${grp.schemaOrBucket}" — click to close`}
                                      >
                                        <td
                                          colSpan={8}
                                          style={{
                                            fontSize: '8.5pt',
                                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                            padding: '2px 12px',
                                            borderBottom: '1px solid #94a3b8',
                                            color: '#1e3a8a',
                                            fontWeight: 700,
                                          }}
                                        >
                                          ▴ Done picking records in {grp.objectType} &ldquo;{grp.schemaOrBucket}&rdquo; &mdash; Click to close
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })
                            )}
                            {/* Pinned Subtotal Row for this Database */}
                            {sortedGroups.length > 0 && (
                              <tr style={{ background: '#f8fafc', borderTop: '2px solid #64748b', height: '26px' }}>
                                <td style={{ ...baseCellStyle, fontWeight: 700, color: '#0f172a', background: '#f1f5f9' }}>
                                  SUBTOTAL
                                </td>
                                <td style={{ ...baseCellStyle, fontWeight: 700, color: '#0f172a', background: '#f1f5f9' }}>
                                  {db.projectName || db.name}
                                </td>
                                <td style={{ ...baseCellStyle, fontWeight: 600, color: '#475569', background: '#f1f5f9' }}>
                                  {allObjects.length} objects ({tables.length} tables, {binaries.length} binaries)
                                </td>
                                <td style={{ ...baseCellStyle, textAlign: 'right', fontWeight: 700, color: '#0f172a', background: '#f1f5f9' }}>
                                  {formatMb(dbSummary.totalSourceMb)}
                                </td>
                                <td style={{ ...baseCellStyle, color: '#94a3b8', background: '#f1f5f9' }}>—</td>
                                <td style={{ ...baseCellStyle, color: '#94a3b8', background: '#f1f5f9' }}>—</td>
                                <td style={{ ...baseCellStyle, textAlign: 'center', fontWeight: 700, color: '#1e3a8a', background: '#e0f2fe' }}>
                                  Database Subtotal Included:
                                </td>
                                <td style={{ ...baseCellStyle, textAlign: 'right', fontWeight: 700, color: '#0f766e', fontSize: '9pt', background: '#e0f2fe' }}>
                                  {formatMb(dbSummary.includedMb)}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Quick Add Custom Table Input */}
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                          <input
                            type="text"
                            placeholder="Add custom table e.g. public.analytics_log"
                            value={newTableInputs[db.id] || ''}
                            onChange={(e) => setNewTableInputs({ ...newTableInputs, [db.id]: e.target.value })}
                            style={{
                              flex: 1,
                              background: '#161b22',
                              border: '1px solid #30363d',
                              borderRadius: '4px',
                              padding: '5px 10px',
                              color: '#fff',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                            }}
                          />
                          <button
                            type="button"
                            className="pb-btn pb-btn-sm"
                            onClick={() => handleAddTable(db.id)}
                            style={{ fontSize: '11px', padding: '4px 12px' }}
                          >
                            + Add Table
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Grand Sum Total Bar across all Projects & Databases */}
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Selected Databases</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f0f6fc' }}>
              {summary.selectedCount} <span style={{ fontSize: '12px', fontWeight: 400, color: '#8b949e' }}>of {dbs.length}</span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid #30363d', paddingLeft: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Tables (DDL + Data)</div>
            <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace', color: '#c9d1d9' }}>
              {(summary.includedDatabaseMb ?? 0).toFixed(2)} MB
            </div>
          </div>

          <div style={{ borderLeft: '1px solid #30363d', paddingLeft: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Included Binary Storage</div>
            <div style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'monospace', color: '#d2a8ff' }}>
              {(summary.includedBinaryMb ?? 0).toFixed(2)} MB
            </div>
          </div>

          <div style={{ borderLeft: '1px solid #30363d', paddingLeft: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Grand Sum Total (All Databases + Binaries)</div>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: '#3ecf8e' }}>
              {typeof summary.grandTotalMb === 'number' && summary.grandTotalMb >= 0
                ? `${summary.grandTotalMb.toFixed(2)} MB`
                : '?? MB'}
              {summary.savedMb > 0 && (
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#7ee787', marginLeft: '8px' }}>
                  ({summary.savedMb} MB excluded/saved)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Target Budget Cap & Safety Gauge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Target Budget Cap:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                value={targetCapMb}
                onChange={(e) => setTargetCapMb(Math.max(1, Number(e.target.value) || 1))}
                style={{
                  width: '72px',
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  color: '#f0f6fc',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  textAlign: 'right',
                }}
              />
              <span style={{ fontSize: '11px', color: '#8b949e' }}>MB</span>
            </div>
          </div>
          {/* Visual Progress Bar */}
          <div style={{
            width: '100%',
            height: '8px',
            background: '#21262d',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(100, ((summary.grandTotalMb || 0) / targetCapMb) * 100)}%`,
              height: '100%',
              background: (summary.grandTotalMb || 0) > targetCapMb
                ? '#f85149'
                : (summary.grandTotalMb || 0) > targetCapMb * 0.85
                  ? '#d29922'
                  : '#3ecf8e',
              transition: 'width 0.2s ease',
            }} />
          </div>
          <div style={{ fontSize: '10.5px', color: (summary.grandTotalMb || 0) > targetCapMb ? '#f85149' : '#8b949e', textAlign: 'right' }}>
            {(summary.grandTotalMb || 0) <= targetCapMb
              ? `${(targetCapMb - (summary.grandTotalMb || 0)).toFixed(2)} MB remaining under cap`
              : `⚠️ Exceeds cap by ${((summary.grandTotalMb || 0) - targetCapMb).toFixed(2)} MB`}
          </div>
        </div>
      </div>
    </div>
  );
}
