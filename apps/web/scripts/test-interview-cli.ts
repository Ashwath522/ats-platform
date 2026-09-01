import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { generateAiQuestions } from '../lib/interview-questions'
import { decideNextInterviewStep } from '../lib/llm/interviewer'

const rl = readline.createInterface({ input, output })

async function main() {
  console.log('=== AI Interview CLI Tester ===\n')

  const jobTitle = await rl.question('Job title: ')
  console.log('Paste job description (end with a blank line):')
  const jdLines: string[] = []
  while (true) {
    const line = await rl.question('')
    if (line.trim() === '') break
    jdLines.push(line)
  }
  const jobDescription = jdLines.join('\n')

  const questions = generateAiQuestions(jobTitle, jobDescription)
  const baseQuestions = questions.map((q) => q.question)

  if (!baseQuestions.length) {
    console.log('\nNo questions could be generated from that job description. Try adding more detail (skills, responsibilities).')
    rl.close()
    return
  }

  console.log(`\nGenerated ${baseQuestions.length} base questions from the JD:\n`)
  baseQuestions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`))
  console.log('\n--- Interview starting ---\n')

  let baseQuestionIndex = 0
  let currentQuestion = baseQuestions[0]
  let isFollowUpQuestion = false
  const priorQA: { question: string; answer: string }[] = []

  while (true) {
    console.log(`\nQ: ${currentQuestion}`)
    const rawAnswer = await rl.question('Your answer: ')
    
    // Sanitize answer: remove leading/trailing whitespace, normalize internal spacing
    // This fixes the readline buffer corruption where partial previous input leaks through
    const answer = rawAnswer
      .replace(/^\s+|\s+$/g, '') // trim ends
      .replace(/\s+/g, ' ') // normalize internal spacing
      .trim()
    
    // Log raw vs sanitized for debugging transcript corruption
    if (rawAnswer !== answer) {
      console.log(`[debug buffer state] raw input length: ${rawAnswer.length}, sanitized: ${answer.length}`)
    }

    const result = await decideNextInterviewStep({
      jobTitle,
      jobDescription,
      baseQuestions,
      baseQuestionIndex,
      isFollowUpQuestion,
      currentQuestion,
      candidateAnswer: answer,
      priorQA,
    })

    priorQA.push({ question: currentQuestion, answer })

    console.log(`\n[engine decision: ${result.action}]`)

    if (result.action === 'complete') {
      console.log('\n--- Interview complete ---')
      break
    }

    if (result.action === 'ended_by_candidate') {
      console.log('\n--- Candidate chose to end the interview early ---')
      break
    }

    if (result.action === 'follow_up') {
      currentQuestion = result.question ?? '(no question returned)'
      isFollowUpQuestion = true
      continue
    }

    if (result.action === 'next_base') {
      currentQuestion = result.question ?? baseQuestions[result.nextBaseIndex ?? baseQuestionIndex + 1]
      baseQuestionIndex = result.nextBaseIndex ?? baseQuestionIndex + 1
      isFollowUpQuestion = false
      continue
    }
  }

  rl.close()
}

main()
