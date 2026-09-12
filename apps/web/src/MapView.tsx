import { useCallback, useMemo } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, Position, ReactFlow,
  getSmoothStepPath,
  type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type EdgeTypes,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ObjectId, ProjectState, Thought, ThoughtType } from '@noesis/core';
import { useStudio } from './store.js';

/** Each type gets a colour role, so the map reads by kind before it reads by text. */
const HUE: Record<ThoughtType, string> = {
  NOTICE: 'var(--text-2)',
  WONDER: 'var(--text-2)',
  TENSION: 'var(--brand)',
  UNKNOWN: 'var(--brand)',
  QUESTION: 'var(--brand)',
  IDEA: 'var(--text-2)',
  CLAIM: 'var(--text)',
  EVIDENCE: 'var(--ext)',
  CHALLENGE: 'var(--coach)',
  ALTERNATIVE: 'var(--coach)',
  ASSUMPTION: 'var(--coach)',
  SYNTHESIS: 'var(--ext)',
};

interface ThoughtData extends Record<string, unknown> {
  thought: Thought;
  versions: number;
  cite: string | null;
  selected: boolean;
  comments: number;
}

function ThoughtNode({ data }: NodeProps<Node<ThoughtData>>) {
  const { thought, versions, cite, selected, comments } = data;
  return (
    <div className={`tnode${selected ? ' sel' : ''}${thought.archived ? ' arch' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="hd">
        <span className="ty mono" style={{ color: HUE[thought.type] }}>{thought.type}</span>
        <span className="vr mono">
          v{versions}{thought.archived ? ' · archived' : ''}
        </span>
      </div>
      <div className="bd">{thought.text === '' ? <em>Empty</em> : thought.text}</div>
      {(cite !== null || thought.note !== '' || comments > 0) && (
        <div className="ft">
          {cite !== null && <span className="cite mono">{cite}</span>}
          {thought.note !== '' && <span>{thought.note}</span>}
          {comments > 0 && (
            <span className="mono" style={{ color: 'var(--brand)' }}>
              {comments} comment{comments === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function RelationEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, id }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10,
  });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--border-2)', strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          className="mono"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: 'var(--bg)', padding: '1px 5px', borderRadius: 3,
            fontSize: 10, color: 'var(--ext)', pointerEvents: 'none',
          }}
        >
          {String(label ?? '')}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes: NodeTypes = { thought: ThoughtNode };
const edgeTypes: EdgeTypes = { relation: RelationEdge };

function build(state: ProjectState, selected: ObjectId | null): { nodes: Node<ThoughtData>[]; edges: Edge[] } {
  const commentsPer = new Map<string, number>();
  for (const c of Object.values(state.comments)) {
    commentsPer.set(c.objectId, (commentsPer.get(c.objectId) ?? 0) + 1);
  }

  const nodes = Object.values(state.thoughts).map<Node<ThoughtData>>((thought) => {
    const source = thought.evidence ? state.sources[thought.evidence.sourceId] : undefined;
    return {
      id: thought.objectId,
      type: 'thought',
      position: thought.position,
      data: {
        thought,
        versions: (state.versions[thought.objectId] ?? []).length,
        cite: source?.cite ?? null,
        selected: thought.objectId === selected,
        comments: commentsPer.get(thought.objectId) ?? 0,
      },
    };
  });

  const edges = Object.values(state.relations)
    .filter((r) => !r.removed)
    .map<Edge>((r) => ({
      id: r.relationId,
      source: r.from,
      target: r.to,
      type: 'relation',
      label: r.relation.replace(/_/g, ' '),
    }));

  return { nodes, edges };
}

export default function MapView() {
  const state = useStudio((s) => s.state);
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);
  const write = useStudio((s) => s.write);
  const role = useStudio((s) => s.role);

  const { nodes, edges } = useMemo(() => build(state, selected), [state, selected]);

  /** Dragging persists as `thought.moved`, which mints no version. Layout is not provenance. */
  const onNodesChange = useCallback((changes: NodeChange<Node<ThoughtData>>[]) => {
    if (role !== 'student') return;
    for (const change of changes) {
      if (change.type === 'position' && change.dragging === false && change.position) {
        void write('student', 'thought.moved', {
          objectId: change.id, position: { x: Math.round(change.position.x), y: Math.round(change.position.y) },
        });
      }
    }
  }, [role, write]);

  return (
    <div className="flowwrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => select(node.id as ObjectId)}
        onPaneClick={() => select(null)}
        nodesDraggable={role === 'student'}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border-2)" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
