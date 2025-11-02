import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { wikify } from '../../wikificator';

suite('Wikificator Test Suite', () => {
	vscode.window.showInformationMessage('Start Wikificator tests.');

	const testsRoot = path.resolve(__dirname, '../../../tests/wikificator');
    if (!fs.existsSync(testsRoot)) {
        return;
    }
	const testCases = fs.readdirSync(testsRoot, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

	testCases.forEach(testCase => {
		test(`Should wikify ${testCase}`, () => {
			const testDir = path.join(testsRoot, testCase);
			const sourcePath = path.join(testDir, 'source.mw');
			const fixedPath = path.join(testDir, 'fixed.mw');

			const sourceText = fs.readFileSync(sourcePath, 'utf-8');
			const expectedText = fs.readFileSync(fixedPath, 'utf-8');

			const actualText = wikify(sourceText);

			assert.strictEqual(actualText.trim(), expectedText.trim());
		});
	});
});
