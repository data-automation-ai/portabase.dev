import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import {
  DATABASE_COPY_MODES,
  TABLE_COPY_MODES,
  computeDatabaseScopeSummary,
  createDefaultDatabaseScope,
} from '../../cloud/runner/database-scope.mjs';

function parseObjectName(name) {
  if (typeof name !== 'string') return { schema: 'public', name: '' };
  const parts = name.split('.');
  if (parts.length > 1) {
    return { schema: parts[0], name: parts.slice(1).join('.') };
  }
  return { schema: 'public', name };
}

function formatTableSize(sizeMb) {
  if (typeof sizeMb !== 'number' || sizeMb < 0) return '?? MB';
  if (sizeMb === 0) return '0 MB';
  if (sizeMb < 1) return '< 1 MB';
  return `~${Math.round(sizeMb)} MB`;
}

function formatRows(rows) {
  if (typeof rows !== 'number' || rows < 0) return '?? rows';
  return `${rows.toLocaleString()} rows`;
}

/**
 * Visual Multi-Database & Table Scope Selector
 * 
 * Allows users to choose which databases and tables to back up with intuitive
 * "Structure + Data" vs. "Structure Only" toggles.
 */
export function DatabaseScopeSelector({
  databases = [],
  onChange = null,
  readOnly = false,
}) {
  const [expandedDbId, setExpandedDbId] = useState(null);
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
    const next = dbs.map((db) => {
      if (db.id === id) {
        return { ...db, enabled: !db.enabled };
      }
      return db;
    });
    updateDatabases(next);
  };

  const handleSetDbMode = (id, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => {
      if (db.id === id) {
        return { ...db, mode };
      }
      return db;
    });
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

  const handleSetTableMode = (dbId, tableName, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => {
      if (db.id === dbId) {
        const tables = (db.tables || []).map((t) => {
          if (t.name === tableName) {
            return { ...t, mode };
          }
          return t;
        });
        return { ...db, tables };
      }
      return db;
    });
    updateDatabases(next);
  };

  const handleToggleTableStructure = (dbId, tableName) => {
    if (readOnly) return;
    const targetDb = dbs.find(d => d.id === dbId);
    const currentTable = targetDb?.tables?.find(t => t.name === tableName);
    const currentMode = currentTable?.mode || TABLE_COPY_MODES.STRUCTURE_AND_DATA;
    const nextMode = currentMode === TABLE_COPY_MODES.SKIP
      ? TABLE_COPY_MODES.STRUCTURE_ONLY
      : TABLE_COPY_MODES.SKIP;
    handleSetTableMode(dbId, tableName, nextMode);
  };

  const handleToggleTableData = (dbId, tableName) => {
    if (readOnly) return;
    const targetDb = dbs.find(d => d.id === dbId);
    const currentTable = targetDb?.tables?.find(t => t.name === tableName);
    const currentMode = currentTable?.mode || TABLE_COPY_MODES.STRUCTURE_AND_DATA;
    const nextMode = currentMode === TABLE_COPY_MODES.STRUCTURE_AND_DATA
      ? TABLE_COPY_MODES.STRUCTURE_ONLY
      : TABLE_COPY_MODES.STRUCTURE_AND_DATA;
    handleSetTableMode(dbId, tableName, nextMode);
  };

  const handleSetAllTablesMode = (dbId, mode) => {
    if (readOnly) return;
    const next = dbs.map((db) => {
      if (db.id === dbId) {
        const tables = (db.tables || []).map((t) => ({ ...t, mode }));
        return { ...db, tables };
      }
      return db;
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
          direction: column === 'size' || column === 'rows' ? 'desc' : 'asc',
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

    const friendlyName = newDbName.trim() || `Supabase App (${cleanRef.slice(0, 6)})`;
    const newDb = {
      id: `db_${cleanRef.slice(0, 8)}_${Date.now().toString(36)}`,
      projectRef: cleanRef,
      name: friendlyName,
      estimatedSizeMb: null,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [],
    };

    updateDatabases([...dbs, newDb]);
    setNewDbInput('');
    setNewDbName('');
    setShowAddDb(false);
  };

  const handleRemoveDatabase = (id) => {
    if (readOnly || dbs.length <= 1) return;
    const next = dbs.filter((db) => db.id !== id);
    updateDatabases(next);
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
          name: formattedName,
          rowsEstimate: null,
          sizeMb: null,
          mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA,
        };
        return { ...db, tables: [...(db.tables || []), newTable] };
      }
      return db;
    });

    updateDatabases(next);
    setNewTableInputs({ ...newTableInputs, [dbId]: '' });
  };

  const getSortedTables = (tables, dbId) => {
    let filtered = tables;
    const query = (searchQuery[dbId] || '').trim().toLowerCase();
    if (query) {
      filtered = tables.filter((t) => {
        const { schema, name } = parseObjectName(t.name);
        return (
          schema.toLowerCase().includes(query) ||
          name.toLowerCase().includes(query) ||
          t.name.toLowerCase().includes(query)
        );
      });
    }

    const { column = 'size', direction = 'desc' } = sortConfig[dbId] || { column: 'size', direction: 'desc' };
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      const aObj = parseObjectName(a.name);
      const bObj = parseObjectName(b.name);

      if (column === 'schema') {
        const cmp = aObj.schema.localeCompare(bObj.schema);
        return cmp !== 0 ? cmp * multiplier : aObj.name.localeCompare(bObj.name) * multiplier;
      }
      if (column === 'name') {
        return aObj.name.localeCompare(bObj.name) * multiplier;
      }
      if (column === 'size') {
        const aSize = typeof a.sizeMb === 'number' ? a.sizeMb : -1;
        const bSize = typeof b.sizeMb === 'number' ? b.sizeMb : -1;
        return (aSize - bSize) * multiplier;
      }
      if (column === 'rows') {
        const aRows = typeof a.rowsEstimate === 'number' ? a.rowsEstimate : -1;
        const bRows = typeof b.rowsEstimate === 'number' ? b.rowsEstimate : -1;
        return (aRows - bRows) * multiplier;
      }
      if (column === 'structure') {
        const aStruct = a.mode !== TABLE_COPY_MODES.SKIP ? 1 : 0;
        const bStruct = b.mode !== TABLE_COPY_MODES.SKIP ? 1 : 0;
        return (aStruct - bStruct) * multiplier;
      }
      if (column === 'data') {
        const aData = a.mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA ? 1 : 0;
        const bData = b.mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA ? 1 : 0;
        return (aData - bData) * multiplier;
      }
      if (column === 'mode') {
        const rank = {
          [TABLE_COPY_MODES.STRUCTURE_AND_DATA]: 3,
          [TABLE_COPY_MODES.STRUCTURE_ONLY]: 2,
          [TABLE_COPY_MODES.SKIP]: 1,
        };
        return ((rank[a.mode] || 0) - (rank[b.mode] || 0)) * multiplier;
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
          padding: '10px 12px',
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
            Databases &amp; Copy Modes
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#8b949e' }}>
            Choose full data backup or lightning-fast structure-only blueprints.
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
              <Icon name="plus" size={12} /> Add Database
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
              Add Additional Supabase Database / Project
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
                Friendly Name (Optional)
              </label>
              <input
                type="text"
                className="pb-input"
                placeholder="e.g. Staging App or Analytics DB"
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
              Add to Backup Scope
            </button>
          </div>
        </form>
      )}

      {/* Database Cards List */}
      <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
        {dbs.map((db) => {
          const isExpanded = expandedDbId === db.id;
          const isStructureOnly = db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY;
          const tables = Array.isArray(db.tables) ? db.tables : [];
          const sortedTables = getSortedTables(tables, db.id);
          const skippedCount = tables.filter((t) => t.mode === TABLE_COPY_MODES.SKIP).length;
          const structOnlyTableCount = tables.filter((t) => t.mode === TABLE_COPY_MODES.STRUCTURE_ONLY).length;
          const fullCount = tables.length - structOnlyTableCount - skippedCount;

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
              {/* Header row: Checkbox, Name, Ref, Size & Pill toggle */}
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
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px', color: '#f0f6fc' }}>
                        {db.name || 'Supabase Database'}
                      </strong>
                      {db.projectRef && (
                        <span
                          className="pb-badge"
                          style={{ fontFamily: 'monospace', fontSize: '11px', background: '#21262d' }}
                        >
                          {db.projectRef}
                        </span>
                      )}
                      <span
                        className="pb-badge pb-badge-ok"
                        style={{ fontSize: '11px' }}
                      >
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
                          : `Structure + Data + Objects · ${tables.length} objects (${fullCount} full, ${structOnlyTableCount} blueprint, ${skippedCount} skipped)`}
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
                        transition: 'all 0.15s ease',
                      }}
                      title="Include entire database structure plus table data rows and storage objects"
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
                        transition: 'all 0.15s ease',
                      }}
                      title="Include entire database structure only (schema DDL, tables, views, RLS; skip row payloads)"
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
                      <span>{isExpanded ? '▴ Hide spreadsheet of database objects' : '▾ Click into database objects (Spreadsheet View)'}</span>
                      <span className="pb-badge" style={{ fontSize: '11px', background: '#21262d', color: '#c9d1d9' }}>
                        {tables.length} objects
                      </span>
                    </button>

                    <div style={{ fontSize: '11px', color: '#8b949e' }}>
                      {structOnlyTableCount > 0 && <span style={{ color: '#7ee787', marginRight: '8px' }}>⚡ {structOnlyTableCount} Structure Only</span>}
                      {skippedCount > 0 && <span style={{ color: '#f85149', marginRight: '8px' }}>✕ {skippedCount} Skipped</span>}
                      <span>✓ {fullCount} Full</span>
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
                            placeholder="Filter by schema or table name..."
                            value={searchQuery[db.id] || ''}
                            onChange={(e) => setSearchQuery({ ...searchQuery, [db.id]: e.target.value })}
                            style={{
                              width: '100%',
                              maxWidth: '320px',
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
                              onClick={() => handleSetAllTablesMode(db.id, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                              style={{ fontSize: '11px', padding: '3px 8px', background: '#1f6feb', color: '#fff' }}
                              title="Include structure and data for all tables"
                            >
                              All Full
                            </button>
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm"
                              onClick={() => handleSetAllTablesMode(db.id, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                              style={{ fontSize: '11px', padding: '3px 8px', background: '#238636', color: '#fff' }}
                              title="Include structure only for all tables (save data size)"
                            >
                              All Structure Only ⚡
                            </button>
                            <button
                              type="button"
                              className="pb-btn pb-btn-sm pb-btn-ghost"
                              onClick={() => handleSetAllTablesMode(db.id, TABLE_COPY_MODES.SKIP)}
                              style={{ fontSize: '11px', padding: '3px 8px', color: '#f85149' }}
                              title="Skip all tables"
                            >
                              Skip All
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Spreadsheet Table Grid */}
                      <div className="pb-table-wrap" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                        <table className="pb-table" style={{ fontSize: '12px', minWidth: '600px' }}>
                          <thead>
                            <tr>
                              {renderSortHeader(db.id, 'schema', 'Schema', 'left')}
                              {renderSortHeader(db.id, 'name', 'Table Name', 'left')}
                              {renderSortHeader(db.id, 'size', 'Size', 'right')}
                              {renderSortHeader(db.id, 'rows', 'Rows', 'right')}
                              {renderSortHeader(db.id, 'structure', 'Structure', 'center')}
                              {renderSortHeader(db.id, 'data', 'Data', 'center')}
                              {renderSortHeader(db.id, 'mode', 'Copy Mode (Trinary)', 'center')}
                            </tr>
                          </thead>
                          <tbody>
                            {sortedTables.length === 0 ? (
                              <tr>
                                <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: '#8b949e', fontSize: '12px' }}>
                                  {tables.length === 0
                                    ? 'No tables discovered yet for this database. Use the input below to add tables or keep Structure + Data for all.'
                                    : 'No tables match the search filter.'}
                                </td>
                              </tr>
                            ) : (
                              sortedTables.map((table) => {
                                const { schema, name } = parseObjectName(table.name);
                                const isFull = table.mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA;
                                const isStructureOnlyTable = table.mode === TABLE_COPY_MODES.STRUCTURE_ONLY;
                                const isSkip = table.mode === TABLE_COPY_MODES.SKIP;

                                return (
                                  <tr key={table.name} style={{ background: isSkip ? 'rgba(248, 81, 73, 0.04)' : undefined }}>
                                    <td>
                                      <span className="pb-badge" style={{ fontFamily: 'monospace', fontSize: '11px', background: '#21262d', color: '#8b949e' }}>
                                        {schema}
                                      </span>
                                    </td>
                                    <td>
                                      <strong style={{ fontFamily: 'monospace', fontSize: '12px', color: isSkip ? '#8b949e' : '#f0f6fc' }}>
                                        {name}
                                      </strong>
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#8b949e' }}>
                                      {formatTableSize(table.sizeMb)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#8b949e' }}>
                                      {formatRows(table.rowsEstimate)}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      <input
                                        type="checkbox"
                                        checked={!isSkip}
                                        onChange={() => handleToggleTableStructure(db.id, table.name)}
                                        disabled={readOnly}
                                        style={{ cursor: readOnly ? 'default' : 'pointer', width: '15px', height: '15px' }}
                                        title="Include Structure: DDL, schema, indexes, and RLS policies"
                                        aria-label={`Include structure for ${table.name}`}
                                      />
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      <input
                                        type="checkbox"
                                        checked={isFull}
                                        disabled={isSkip || readOnly}
                                        onChange={() => handleToggleTableData(db.id, table.name)}
                                        style={{ cursor: isSkip || readOnly ? 'default' : 'pointer', width: '15px', height: '15px' }}
                                        title={isSkip ? 'Structure must be checked to include data' : 'Include Data: copy row payloads'}
                                        aria-label={`Include data for ${table.name}`}
                                      />
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      {/* Trinary Control Pill */}
                                      <div
                                        style={{
                                          display: 'inline-flex',
                                          background: '#0d1117',
                                          borderRadius: '4px',
                                          border: '1px solid #30363d',
                                          padding: '2px',
                                        }}
                                        role="group"
                                        aria-label={`Inclusion mode for ${table.name}`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
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
                                            transition: 'all 0.15s ease',
                                          }}
                                          title="Fully include: structure + data"
                                        >
                                          Full
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                                          disabled={readOnly}
                                          style={{
                                            padding: '2px 7px',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            borderRadius: '3px',
                                            border: 'none',
                                            cursor: readOnly ? 'default' : 'pointer',
                                            background: isStructureOnlyTable ? '#238636' : 'transparent',
                                            color: isStructureOnlyTable ? '#fff' : '#8b949e',
                                            transition: 'all 0.15s ease',
                                          }}
                                          title="Include with data structure only (0 row payloads)"
                                        >
                                          Structure Only ⚡
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.SKIP)}
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
                                            transition: 'all 0.15s ease',
                                          }}
                                          title="Do not include (skip table)"
                                        >
                                          Skip
                                        </button>
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

      {/* Bottom Live Estimate Bar */}
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Selected Databases</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f0f6fc' }}>
              {summary.selectedCount} <span style={{ fontSize: '12px', fontWeight: 400, color: '#8b949e' }}>of {dbs.length}</span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid #30363d', paddingLeft: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8b949e', textTransform: 'uppercase' }}>Estimated Capsule Size</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#3ecf8e' }}>
              {typeof summary.estimatedCompressedMb === 'number' && summary.estimatedCompressedMb >= 0
                ? `~${summary.estimatedCompressedMb} MB`
                : '?? MB'}
              {summary.savedMb > 0 && (
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#7ee787', marginLeft: '6px' }}>
                  ({summary.savedMb} MB saved by Structure Only)
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
