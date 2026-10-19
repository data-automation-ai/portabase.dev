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
  const [newDbInput, setNewDbInput] = useState('');
  const [newDbName, setNewDbName] = useState('');
  const [showAddDb, setShowAddDb] = useState(false);
  const [newTableInputs, setNewTableInputs] = useState({});
  const [sortConfig, setSortConfig] = useState({});
  const [searchQuery, setSearchQuery] = useState({});

  const dbs = Array.isArray(databases) && databases.length > 0
    ? databases
    : createDefaultDatabaseScope();

  const summary = computeDatabaseScopeSummary(dbs);

  const updateDatabases = (nextDbs) => {
    onChange?.(nextDbs);
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
    return [...tables, ...binaries];
  };

  const getSortedObjects = (db) => {
    const allRows = getAllRowsForDb(db);
    let filtered = allRows;
    const query = (searchQuery[db.id] || '').trim().toLowerCase();
    if (query) {
      filtered = allRows.filter((row) => {
        const parsed = parseObjectRow(row);
        return (
          parsed.objectType.toLowerCase().includes(query) ||
          parsed.schemaOrBucket.toLowerCase().includes(query) ||
          parsed.objectName.toLowerCase().includes(query) ||
          parsed.key.toLowerCase().includes(query)
        );
      });
    }

    const { column = 'size', direction = 'desc' } = sortConfig[db.id] || { column: 'size', direction: 'desc' };
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
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

  const renderSortHeader = (dbId, column, label, align = 'left') => {
    const current = sortConfig[dbId] || { column: 'size', direction: 'desc' };
    const isActive = current.column === column;
    const arrow = isActive ? (current.direction === 'asc' ? ' ▲' : ' ▼') : ' ↕';

    return (
      <th
        onClick={() => handleSort(dbId, column)}
        style={{
          textAlign: align,
          cursor: 'pointer',
          userSelect: 'none',
          color: isActive ? '#f0f6fc' : undefined,
          background: isActive ? '#1c2128' : undefined,
          padding: '10px 10px',
          whiteSpace: 'nowrap',
        }}
        title={`Click to sort by ${label}`}
      >
        <span>{label}</span>
        <span style={{ fontSize: '10px', opacity: isActive ? 1 : 0.4, marginLeft: '4px' }}>{arrow}</span>
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
          const sortedObjects = getSortedObjects(db);
          const dbMetrics = summary.perDatabase?.[db.id] || {};
          const skippedCount = allObjects.filter((t) => t.mode === TABLE_COPY_MODES.SKIP || t.mode === 'exclude').length;
          const structOnlyTableCount = allObjects.filter((t) => t.mode === TABLE_COPY_MODES.STRUCTURE_ONLY).length;
          const fullCount = allObjects.length - structOnlyTableCount - skippedCount;

          // Running stacked MB accumulator across visible rows
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
                          : `Structure + Data + Binaries · ${allObjects.length} objects (${fullCount} included, ${structOnlyTableCount} structure-only, ${skippedCount} excluded)`}
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
                      <span>{isExpanded ? '▴ Hide spreadsheet of database & binary objects' : '▾ Click into database objects (Spreadsheet View)'}</span>
                      <span className="pb-badge" style={{ fontSize: '11px', background: '#21262d', color: '#c9d1d9' }}>
                        {allObjects.length} objects
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
                      {/* Spreadsheet Header Toolbar: Search & Bulk Action Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
                          <input
                            type="text"
                            placeholder="Filter by object type, schema, bucket, or name..."
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

                      {/* Spreadsheet Table Grid */}
                      <div className="pb-table-wrap" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                        <table className="pb-table" style={{ fontSize: '12px', minWidth: '860px', width: '100%' }}>
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
                            {sortedObjects.length === 0 ? (
                              <tr>
                                <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: '#8b949e', fontSize: '12px' }}>
                                  {allObjects.length === 0
                                    ? 'No objects discovered yet for this database. Connect via OAuth inside the runner or add custom objects below.'
                                    : 'No objects match the search filter.'}
                                </td>
                              </tr>
                            ) : (
                              sortedObjects.map((item) => {
                                const parsed = parseObjectRow(item);
                                const isBinary = parsed.isBinary;
                                const mode = item.mode || (isBinary ? BINARY_COPY_MODES.INCLUDE : TABLE_COPY_MODES.STRUCTURE_AND_DATA);
                                const isSkip = mode === TABLE_COPY_MODES.SKIP || mode === 'exclude';
                                const isStructureOnlyRow = !isBinary && mode === TABLE_COPY_MODES.STRUCTURE_ONLY;
                                const isFull = !isSkip && !isStructureOnlyRow;

                                const rowIncludedMb = computeObjectIncludedMb(item, db.mode);
                                runningStackedMb += rowIncludedMb;

                                return (
                                  <tr key={parsed.key} style={{ background: isSkip ? 'rgba(248, 81, 73, 0.04)' : undefined }}>
                                    <td>
                                      <span
                                        className="pb-badge"
                                        style={{
                                          fontFamily: 'monospace',
                                          fontSize: '10px',
                                          background: isBinary ? '#1f2d3d' : '#21262d',
                                          color: isBinary ? '#79c0ff' : '#3ecf8e',
                                        }}
                                      >
                                        {parsed.objectType}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        className="pb-badge"
                                        style={{
                                          fontFamily: 'monospace',
                                          fontSize: '11px',
                                          background: '#21262d',
                                          color: isBinary ? '#d2a8ff' : '#8b949e',
                                        }}
                                        title={isBinary ? 'Storage Bucket' : 'Database Schema'}
                                      >
                                        {isBinary ? `🪣 ${parsed.schemaOrBucket}` : parsed.schemaOrBucket}
                                      </span>
                                    </td>
                                    <td>
                                      <strong style={{ fontFamily: 'monospace', fontSize: '12px', color: isSkip ? '#8b949e' : '#f0f6fc' }}>
                                        {parsed.objectName}
                                      </strong>
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#c9d1d9' }}>
                                      {formatMb(item.sizeMb)}
                                    </td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8b949e' }}>
                                      {formatDate(item.createdAt)}
                                    </td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8b949e' }}>
                                      {formatDate(item.updatedAt)}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      {isBinary ? (
                                        /* Binary Object 2-Way Switch: Exclude vs Include in Manifest */
                                        <div
                                          style={{
                                            display: 'inline-flex',
                                            background: '#0d1117',
                                            borderRadius: '4px',
                                            border: '1px solid #30363d',
                                            padding: '2px',
                                          }}
                                          role="group"
                                          aria-label={`Binary export mode for ${parsed.key}`}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => handleSetObjectMode(db.id, parsed.key, true, BINARY_COPY_MODES.EXCLUDE)}
                                            disabled={readOnly}
                                            style={{
                                              padding: '2px 8px',
                                              fontSize: '11px',
                                              fontWeight: 600,
                                              borderRadius: '3px',
                                              border: 'none',
                                              cursor: readOnly ? 'default' : 'pointer',
                                              background: isSkip ? '#b91c1c' : 'transparent',
                                              color: isSkip ? '#fff' : '#8b949e',
                                            }}
                                          >
                                            Exclude
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleSetObjectMode(db.id, parsed.key, true, BINARY_COPY_MODES.INCLUDE)}
                                            disabled={readOnly}
                                            style={{
                                              padding: '2px 8px',
                                              fontSize: '11px',
                                              fontWeight: 600,
                                              borderRadius: '3px',
                                              border: 'none',
                                              cursor: readOnly ? 'default' : 'pointer',
                                              background: !isSkip ? '#1f6feb' : 'transparent',
                                              color: !isSkip ? '#fff' : '#8b949e',
                                            }}
                                          >
                                            Include in Manifest
                                          </button>
                                        </div>
                                      ) : (
                                        /* Database Object 3-Way Switch: Exclude | Include structure only | Include structure and data */
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
                                              background: '#0d1117',
                                              borderRadius: '4px',
                                              border: '1px solid #30363d',
                                              padding: '2px',
                                            }}
                                            role="group"
                                            aria-label={`Inclusion mode for ${parsed.key}`}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => handleSetObjectMode(db.id, parsed.key, false, TABLE_COPY_MODES.SKIP)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '2px 7px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                borderRadius: '3px',
                                                border: 'none',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isSkip ? '#b91c1c' : 'transparent',
                                                color: isSkip ? '#fff' : '#8b949e',
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
                                                padding: '2px 7px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                borderRadius: '3px',
                                                border: 'none',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isStructureOnlyRow ? '#238636' : 'transparent',
                                                color: isStructureOnlyRow ? '#fff' : '#8b949e',
                                              }}
                                              title="Include structure only (DDL schema, 0 row data)"
                                            >
                                              Structure Only ⚡
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetObjectMode(db.id, parsed.key, false, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                                              disabled={readOnly}
                                              style={{
                                                padding: '2px 7px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                borderRadius: '3px',
                                                border: 'none',
                                                cursor: readOnly ? 'default' : 'pointer',
                                                background: isFull ? '#1f6feb' : 'transparent',
                                                color: isFull ? '#fff' : '#8b949e',
                                              }}
                                              title="Include structure and data"
                                            >
                                              Structure + Data
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                      <div style={{ fontWeight: 700, color: isSkip ? '#6e7681' : '#3ecf8e' }}>
                                        +{rowIncludedMb.toFixed(2)} MB
                                      </div>
                                      <div style={{ fontSize: '10px', color: '#8b949e' }}>
                                        Σ {runningStackedMb.toFixed(2)} MB
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {summary.recommendedTier === 'cloud-7' ? (
            <span
              className="pb-badge pb-badge-ok"
              style={{ fontSize: '12px', padding: '4px 10px', textTransform: 'none' }}
            >
              {summary.estimatedCompressedMb === null
                ? 'Unprobed size · $7/mo Starter (500 MB allowance)'
                : '✓ Fits $7/mo Starter (500 MB allowance)'}
            </span>
          ) : (
            <span
              className="pb-badge"
              style={{
                fontSize: '12px',
                padding: '4px 10px',
                background: '#1c2536',
                color: '#93c5fd',
                textTransform: 'none',
              }}
            >
              Multi-Database / 10 GB Expansion ($17/mo total)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
