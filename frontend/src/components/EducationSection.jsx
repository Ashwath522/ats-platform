import React, { useState } from 'react'
import './EducationSection.css'

export default function EducationSection({ education = [], onUpdate }) {
  const [editingIndex, setEditingIndex] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    level: 'degree',
    institution: '',
    field_of_study: '',
    start_year: '',
    end_year: '',
    grade: '',
  })

  // Sort education by level order
  const levelOrder = { school: 0, pu: 1, degree: 2, pg: 3 }
  const sortedEducation = [...education].sort((a, b) => 
    (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99)
  )

  // Group by level
  const grouped = {}
  sortedEducation.forEach((edu, idx) => {
    if (!grouped[edu.level]) grouped[edu.level] = []
    grouped[edu.level].push({ ...edu, originalIndex: education.indexOf(edu) })
  })

  const levelLabels = {
    school: '🏫 School',
    pu: '📚 PU/12th',
    degree: '🎓 Degree',
    pg: '🏆 Post Graduate',
  }

  const resetForm = () => {
    setFormData({
      level: 'degree',
      institution: '',
      field_of_study: '',
      start_year: '',
      end_year: '',
      grade: '',
    })
    setEditingIndex(null)
    setShowForm(false)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const updated = [...education]
    if (editingIndex !== null) {
      updated[editingIndex] = formData
    } else {
      updated.push(formData)
    }
    onUpdate(updated)
    resetForm()
  }

  const handleDelete = (index) => {
    const updated = education.filter((_, i) => i !== index)
    onUpdate(updated)
  }

  const handleEdit = (edu, index) => {
    setFormData(edu)
    setEditingIndex(index)
    setShowForm(true)
  }

  return (
    <div className="education-section">
      <div className="education-header">
        <h3>🎓 Education</h3>
        {!showForm && (
          <button className="btn-add" onClick={() => setShowForm(true)}>
            + Add Education
          </button>
        )}
      </div>

      {showForm && (
        <form className="education-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Education Level *</label>
              <select
                value={formData.level}
                onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                required
              >
                <option value="school">School</option>
                <option value="pu">PU/12th</option>
                <option value="degree">Degree</option>
                <option value="pg">Post Graduate</option>
              </select>
            </div>
            <div className="form-group">
              <label>Institution *</label>
              <input
                type="text"
                placeholder="University or School Name"
                value={formData.institution}
                onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Field of Study</label>
              <input
                type="text"
                placeholder="e.g., Computer Science"
                value={formData.field_of_study}
                onChange={(e) => setFormData({ ...formData, field_of_study: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Grade / CGPA</label>
              <input
                type="text"
                placeholder="e.g., 3.8/4.0"
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Start Year</label>
              <input
                type="text"
                placeholder="e.g., 2018"
                value={formData.start_year}
                onChange={(e) => setFormData({ ...formData, start_year: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>End Year</label>
              <input
                type="text"
                placeholder="e.g., 2022"
                value={formData.end_year}
                onChange={(e) => setFormData({ ...formData, end_year: e.target.value })}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingIndex !== null ? 'Update' : 'Add'} Education
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {Object.entries(levelOrder)
        .sort(([, a], [, b]) => a - b)
        .map(([level]) => {
          const items = grouped[level] || []
          return items.length > 0 ? (
            <div key={level} className="education-group">
              <h4 className="group-title">{levelLabels[level]}</h4>
              <div className="education-timeline">
                {items.map((edu, idx) => (
                  <div key={idx} className="education-card">
                    <div className="education-dot"></div>
                    <div className="education-content">
                      <div className="education-header-card">
                        <div>
                          <h5>{edu.institution}</h5>
                          {edu.field_of_study && <p className="field">{edu.field_of_study}</p>}
                        </div>
                        <div className="education-actions">
                          <button
                            className="btn-icon"
                            onClick={() => handleEdit(edu, education.indexOf(edu))}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDelete(education.indexOf(edu))}
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="education-details">
                        {edu.start_year && (
                          <span className="year">
                            {edu.start_year}
                            {edu.end_year ? ` - ${edu.end_year}` : ' - Present'}
                          </span>
                        )}
                        {edu.grade && <span className="grade">Grade: {edu.grade}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        })}

      {education.length === 0 && !showForm && (
        <div className="empty-state">
          <p>No education added yet</p>
        </div>
      )}
    </div>
  )
}
