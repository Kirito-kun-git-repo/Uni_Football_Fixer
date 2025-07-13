import React, { useState } from 'react';

function ProfileForm({ profile, onUpdate, msg, error }) {
  const [form, setForm] = useState({
    teamName: profile.teamName || '',
    collegeName: profile.collegeName || '',
  });
  const [profilePicture, setProfilePicture] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleFileChange = (e) => setProfilePicture(e.target.files[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = new FormData();
    data.append('teamName', form.teamName);
    data.append('collegeName', form.collegeName);
    if (profilePicture) data.append('profilePicture', profilePicture);
    onUpdate(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3>Edit Profile</h3>
      {msg && <div style={{ color: 'green' }}>{msg}</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <input
        name="teamName"
        value={form.teamName}
        onChange={handleChange}
        placeholder="Team Name"
        required
      />
      <input
        name="collegeName"
        value={form.collegeName}
        onChange={handleChange}
        placeholder="College Name"
        required
      />
      <div>
        <label>Profile Picture: </label>
        <input type="file" accept="image/*" onChange={handleFileChange} />
        {profile.profilePicture && (
          <div>
            <img
              src={`data:image/jpeg;base64,${profile.profilePicture}`}
              alt="Profile"
              style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: '50%' }}
            />
          </div>
        )}
      </div>
      <button type="submit">Update Profile</button>
    </form>
  );
}

export default ProfileForm;
