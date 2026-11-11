import { describe, expect, it } from 'vitest';
import { OPENING, findOpening } from './opening';

describe('OPENING', () => {
  it('is still what the search for a full story finds', () => {
    // If this fails after changing an algorithm, paste the "received" value into OPENING.
    expect(findOpening()).toEqual(OPENING);
  });
});
