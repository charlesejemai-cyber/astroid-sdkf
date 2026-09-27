/**
 * Verifies the public surface of `@astroid/react` required by issue #261:
 * the agent resource hooks `useAgents`, `useAgent`, and `useCreateAgent` are
 * exported from the package entry point at runtime.
 */

import { describe, expect, it } from 'vitest';
import * as reactPackage from '../index.js';

describe('@astroid/react entry point exports', () => {
  it('exports the useAgents query hook as a function', () => {
    expect(typeof reactPackage.useAgents).toBe('function');
  });

  it('exports the useAgent query hook as a function', () => {
    expect(typeof reactPackage.useAgent).toBe('function');
  });

  it('exports the useCreateAgent mutation hook as a function', () => {
    expect(typeof reactPackage.useCreateAgent).toBe('function');
  });
});
