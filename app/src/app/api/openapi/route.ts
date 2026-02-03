import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi
 * Returns the OpenAPI spec as JSON
 */
export async function GET() {
  try {
    const yamlPath = path.join(process.cwd(), 'public', 'openapi.yaml');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const spec = yaml.load(yamlContent);
    
    return NextResponse.json(spec);
  } catch (error) {
    console.error('Error loading OpenAPI spec:', error);
    return NextResponse.json(
      { error: 'Failed to load OpenAPI spec' },
      { status: 500 }
    );
  }
}
