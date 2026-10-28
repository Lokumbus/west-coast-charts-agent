'use strict'
const { z } = require('zod/v4')

function registerPrompts(server) {
  server.registerPrompt(
    'build_dashboard',
    {
      title: 'Build a dashboard',
      description: 'Plan and build a multi-chart West Coast Charts dashboard for a goal, validating and verifying every chart.',
      argsSchema: {
        goal: z.string().describe('What the dashboard must let someone see or decide, e.g. "ops control room for 3 clusters"'),
        data: z.string().optional().describe('Description or sample of the available data (fields, units, granularity)'),
        charts: z.string().optional().describe('Approximate number of charts, e.g. "4"')
      }
    },
    ({ goal, data, charts }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Build a West Coast Charts dashboard. Goal: ${goal}.`,
              data ? `Available data: ${data}` : 'Ask me for the data if the goal does not make it clear.',
              charts ? `Aim for about ${charts} charts.` : 'Use as few charts as answer the goal well (usually 3-6).',
              '',
              'Process:',
              '1. List the questions the dashboard must answer; one chart per question.',
              '2. For each question pick the type with list_chart_types (free types unless a licence is configured) and start from get_example where one fits.',
              '3. Look up every option you are unsure of with get_schema; do not invent option names.',
              '4. validate_chart each spec and apply the hints until ok is true.',
              '5. render_chart each spec (delivery "link" to save tokens) and read the verification table: check units, that percentiles/rates/scores are not summed (use plotOptions.<type>.aggregate), and that titles state the unit and time window.',
              '6. Use one theme and a consistent colour per entity across charts; link related charts with chart.group where crossfilter makes sense.',
              '7. Return the final specs plus a short HTML/JS snippet that mounts them with new WestCoastCharts(el, spec).render().'
            ].join('\n')
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'pick_chart_type',
    {
      title: 'Pick a chart type for data',
      description: 'Recommend the best West Coast Charts type for a dataset and question, with a validated starter spec.',
      argsSchema: {
        data: z.string().describe('The data: fields, units, number of series/categories/points, or a small sample'),
        question: z.string().optional().describe('What the reader should learn, e.g. "which region is slowest"')
      }
    },
    ({ data, question }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Pick the best West Coast Charts chart type for this data: ${data}`,
              question ? `The reader's question: ${question}` : '',
              '',
              'Call list_chart_types first and choose only from it. Decide by the data shape: time series -> line/area; comparison of categories -> bar (sorted by value); part-to-whole with <= 6 parts -> donut, otherwise stacked bar or treemap; distribution -> boxPlot/histogram-style bar; two measures -> scatter; matrix of categories x time -> heatmap; flows -> sankey (premium); cyclic patterns (hours, months) -> radialColumn (premium) or heatmap.',
              'Give: the recommended type and why (2 sentences), one runner-up, then a minimal spec that passes validate_chart, and the describe_chart summary of it so I can check it says the right thing.'
            ]
              .filter((l) => l !== null)
              .join('\n')
          }
        }
      ]
    })
  )
}

module.exports = { registerPrompts }
