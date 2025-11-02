import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { fixWikiTextLogic, computeOrigins } from '../../extension';

suite('fixWikiText Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	const testsRoot = path.resolve(__dirname, '../../../tests/fixWikiText');
	const testCases = fs.readdirSync(testsRoot, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

	testCases.forEach(testCase => {
		test(`Should fix ${testCase}`, () => {
			const testDir = path.join(testsRoot, testCase);
			const sourcePath = path.join(testDir, 'source.mw');
			const fixedPath = path.join(testDir, 'fixed.mw');

			const sourceText = fs.readFileSync(sourcePath, 'utf-8');
			const expectedText = fs.readFileSync(fixedPath, 'utf-8');
			const configPath = path.join(testDir, 'config.json');

			const configRaw = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(configRaw);
            const { origin, baseDir } = computeOrigins(config.api_url || '');

			const actualText = fixWikiTextLogic(sourceText, origin, baseDir, { fixTypography: false });

			assert.strictEqual(actualText.trim(), expectedText.trim());
		});
	});
});
