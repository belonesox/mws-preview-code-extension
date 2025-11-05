import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { html2mw } from '../../html2mw';

suite('html2mw Test Suite', () => {
	vscode.window.showInformationMessage('Start html2mw tests.');

	const testsRoot = path.resolve(__dirname, '../../../tests/html2mw');
    if (!fs.existsSync(testsRoot)) {
        fs.mkdirSync(testsRoot, { recursive: true });
    }
	const testCases = fs.readdirSync(testsRoot, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

	testCases.forEach(testCase => {
		test(`Should convert ${testCase}`, () => {
			const testDir = path.join(testsRoot, testCase);
			const sourcePath = path.join(testDir, 'source.html');
			const fixedPath = path.join(testDir, 'fixed.mw');

			if (!fs.existsSync(sourcePath) || !fs.existsSync(fixedPath)) {
				console.warn(`Skipping test case "${testCase}" because source.html or fixed.mw is missing.`);
				return;
			}

			const sourceText = fs.readFileSync(sourcePath, 'utf-8');
			const expectedText = fs.readFileSync(fixedPath, 'utf-8');

			const actualText = html2mw(sourceText);

			assert.strictEqual(actualText.trim(), expectedText.trim());
		});
	});
});
