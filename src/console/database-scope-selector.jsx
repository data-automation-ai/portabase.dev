import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import {
  DATABASE_COPY_MODES,
  TABLE_COPY_MODES,
  computeDatabaseScopeSummary,
  createDefaultDatabaseScope,
} from '../../cloud/runner/database-scope.mjs';

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
      estimatedSizeMb: 120,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [
        { name: 'public.users', rowsEstimate: 1000, sizeMb: 12, mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
        { name: 'public.orders', rowsEstimate: 5000, sizeMb: 28, mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
        { name: 'public.audit_logs', rowsEstimate: 25000, sizeMb: 35, mode: TABLE_COPY_MODES.STRUCTURE_ONLY },
      ],
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
          rowsEstimate: 500,
          sizeMb: 5,
          mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA,
        };
        return { ...db, tables: [...(db.tables || []), newTable] };
      }
      return db;
    });

    updateDatabases(next);
    setNewTableInputs({ ...newTableInputs, [dbId]: '' });
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
          const skippedCount = tables.filter((t) => t.mode === TABLE_COPY_MODES.SKIP).length;
          const structOnlyTableCount = tables.filter((t) => t.mode === TABLE_COPY_MODES.STRUCTURE_ONLY).length;

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
                    aria-label={`Enable database ${db.name || db.projectRef}`}
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
                        ~{db.estimatedSizeMb || 100} MB
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      {isStructureOnly
                        ? '⚡ Structure Only: Schemas, tables, DDL & RLS (0 table rows saved)'
                        : `Full backup · ${tables.length} tables (${structOnlyTableCount} blueprint, ${skippedCount} skipped)`}
                    </div>
                  </div>
                </div>

                {/* 2-Pill Segmented Mode Toggle */}
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
                        padding: '5px 10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: db.enabled && !readOnly ? 'pointer' : 'default',
                        background: !isStructureOnly ? '#1f6feb' : 'transparent',
                        color: !isStructureOnly ? '#ffffff' : '#8b949e',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      Structure + Data
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetDbMode(db.id, DATABASE_COPY_MODES.STRUCTURE_ONLY)}
                      disabled={readOnly || !db.enabled}
                      style={{
                        padding: '5px 10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: db.enabled && !readOnly ? 'pointer' : 'default',
                        background: isStructureOnly ? '#238636' : 'transparent',
                        color: isStructureOnly ? '#ffffff' : '#8b949e',
                        transition: 'all 0.15s ease',
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

              {/* Table Customization Drawer Toggle */}
              {db.enabled && !isStructureOnly && (
                <div style={{ marginTop: '10px', borderTop: '1px solid #21262d', paddingTop: '8px' }}>
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
                      gap: '4px',
                      fontWeight: 500,
                    }}
                  >
                    <span>{isExpanded ? '▴ Hide table settings' : '▾ Choose individual tables (Customize Tables)'}</span>
                    <span style={{ color: '#8b949e', fontSize: '11px' }}>({tables.length} tables)</span>
                  </button>

                  {/* Expanded Table List */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: '10px',
                        background: '#0d1117',
                        borderRadius: '6px',
                        border: '1px solid #30363d',
                        padding: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '8px',
                        }}
                      >
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#8b949e', letterSpacing: '0.05em' }}>
                          Table Name
                        </span>
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#8b949e', letterSpacing: '0.05em' }}>
                          Copy Mode
                        </span>
                      </div>

                      <div style={{ display: 'grid', gap: '6px' }}>
                        {tables.length === 0 && (
                          <div style={{ padding: '12px', textAlign: 'center', color: '#8b949e', fontSize: '12px' }}>
                            Tables discovering or no tables found for this database. Use the input below to add specific tables, or keep Structure + Data for all tables.
                          </div>
                        )}
                        {tables.map((table) => (
                          <div
                            key={table.name}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: '#161b22',
                              padding: '6px 10px',
                              borderRadius: '4px',
                              border: '1px solid #21262d',
                              flexWrap: 'wrap',
                              gap: '6px',
                            }}
                          >
                            <div>
                              <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#f0f6fc' }}>
                                {table.name}
                              </span>
                              <span style={{ fontSize: '11px', color: '#8b949e', marginLeft: '8px' }}>
                                ~{table.sizeMb || 0} MB ({table.rowsEstimate ? `${table.rowsEstimate} rows` : 'unknown'})
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                type="button"
                                onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.STRUCTURE_AND_DATA)}
                                disabled={readOnly}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  borderRadius: '3px',
                                  border: '1px solid #30363d',
                                  cursor: readOnly ? 'default' : 'pointer',
                                  background: table.mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA ? '#1f6feb' : '#0d1117',
                                  color: table.mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA ? '#ffffff' : '#8b949e',
                                }}
                              >
                                Structure + Data
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.STRUCTURE_ONLY)}
                                disabled={readOnly}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  borderRadius: '3px',
                                  border: '1px solid #30363d',
                                  cursor: readOnly ? 'default' : 'pointer',
                                  background: table.mode === TABLE_COPY_MODES.STRUCTURE_ONLY ? '#238636' : '#0d1117',
                                  color: table.mode === TABLE_COPY_MODES.STRUCTURE_ONLY ? '#ffffff' : '#8b949e',
                                }}
                              >
                                Structure Only ⚡
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetTableMode(db.id, table.name, TABLE_COPY_MODES.SKIP)}
                                disabled={readOnly}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  borderRadius: '3px',
                                  border: '1px solid #30363d',
                                  cursor: readOnly ? 'default' : 'pointer',
                                  background: table.mode === TABLE_COPY_MODES.SKIP ? '#b91c1c' : '#0d1117',
                                  color: table.mode === TABLE_COPY_MODES.SKIP ? '#ffffff' : '#8b949e',
                                }}
                              >
                                Skip
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Quick Add Custom Table Input */}
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                          <input
                            type="text"
                            placeholder="Add table e.g. public.audit_logs"
                            value={newTableInputs[db.id] || ''}
                            onChange={(e) => setNewTableInputs({ ...newTableInputs, [db.id]: e.target.value })}
                            style={{
                              flex: 1,
                              background: '#161b22',
                              border: '1px solid #30363d',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              color: '#fff',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                            }}
                          />
                          <button
                            type="button"
                            className="pb-btn pb-btn-sm"
                            onClick={() => handleAddTable(db.id)}
                            style={{ fontSize: '11px', padding: '4px 10px' }}
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
              ~{summary.estimatedCompressedMb} MB
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
              ✓ Fits $7/mo Starter (500 MB allowance)
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
