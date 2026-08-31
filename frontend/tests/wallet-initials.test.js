const test = require('node:test');
const assert = require('node:assert/strict');
const { initialsFromAddress } = require('../lib/wallet-initials');
const {
  SAMPLE_ADDRESS,
  DIGIT_LED_ADDRESS,
  EMPTY_ADDRESS,
  NULL_ADDRESS,
  NO_LETTER_ADDRESS,
} = require('./fixtures/wallet-initials.fixture');

test('returns first two letters after the G prefix', () => {
  assert.equal(initialsFromAddress(SAMPLE_ADDRESS), 'AB');
});

test('skips leading digits and returns the first two letters', () => {
  assert.equal(initialsFromAddress(DIGIT_LED_ADDRESS), 'AB');
});

test('returns fallback for empty string', () => {
  assert.equal(initialsFromAddress(EMPTY_ADDRESS), '??');
});

test('returns fallback for null', () => {
  assert.equal(initialsFromAddress(NULL_ADDRESS), '??');
});

test('returns fallback when no letters are present', () => {
  assert.equal(initialsFromAddress(NO_LETTER_ADDRESS), '??');
});

test('returns single initial when only one letter is available', () => {
  assert.equal(initialsFromAddress('G1A23456789234567892345678923456789234567892345'), 'AA');
});